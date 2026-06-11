#!/usr/bin/env node
// plan.mjs — Tool dependency planner for the Composio dep-graph.
//
// Given a Composio tool slug, emits an execution plan answering the core
// question: "before agentically executing tool T, what do we ask the user
// vs which tools must we run first?"
//
//   node scripts/plan.mjs <TOOL_SLUG>            plan for one tool
//   node scripts/plan.mjs <TOOL_SLUG> --depth 2  recurse into producers (default 1, max 3)
//   node scripts/plan.mjs <TOOL_SLUG> --json     structured plan (agent-facing)
//   node scripts/plan.mjs --list <substring>     find tool slugs
//
// Node 22, ESM, stdlib only, no network.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const GRAPH_PATH = join(__dirname, "..", "data", "graph.json");

// ── ANSI (degrade gracefully when not a TTY) ────────────────────────────────
const TTY = process.stdout.isTTY && process.env.NO_COLOR === undefined;
const sgr = (code) => (s) => (TTY ? `\x1b[${code}m${s}\x1b[0m` : `${s}`);
const c = {
  bold: sgr("1"),
  dim: sgr("2"),
  red: sgr("31"),
  green: sgr("32"),
  yellow: sgr("33"),
  blue: sgr("34"),
  magenta: sgr("35"),
  cyan: sgr("36"),
  gray: sgr("90"),
};

// ── Load graph ──────────────────────────────────────────────────────────────
let GRAPH;
try {
  GRAPH = JSON.parse(readFileSync(GRAPH_PATH, "utf8"));
} catch (err) {
  process.stderr.write(`Could not read graph at ${GRAPH_PATH}: ${err.message}\n`);
  process.exit(1);
}

const NODES = new Map(GRAPH.nodes.map((n) => [n.id, n]));
const ETYPES = new Map((GRAPH.entity_types ?? []).map((e) => [e.id, e]));

// incoming edges grouped by consumer -> param
const INCOMING = new Map(); // toolId -> Map(param -> edge[])
for (const e of GRAPH.edges) {
  let byParam = INCOMING.get(e.to);
  if (!byParam) INCOMING.set(e.to, (byParam = new Map()));
  let list = byParam.get(e.param);
  if (!list) byParam.set(e.param, (list = []));
  list.push(e);
}
const producersFor = (toolId, param) =>
  INCOMING.get(toolId)?.get(param) ?? [];

// ── Producer ranking ────────────────────────────────────────────────────────
// Prefer cheap reads (id_lookup / list-style) over creators; break ties by
// confidence; among id_lookup, lightly favour LIST/SEARCH/FETCH style slugs.
const KIND_RANK = { id_lookup: 3, resolver: 2, creator: 1 };
const LISTY = /(^|_)(LIST|SEARCH|FETCH|GET_ALL|FIND)/;

function rankProducers(edges) {
  return [...edges].sort((a, b) => {
    const k = (KIND_RANK[b.kind] ?? 0) - (KIND_RANK[a.kind] ?? 0);
    if (k) return k;
    const conf = (b.confidence ?? 0) - (a.confidence ?? 0);
    if (conf) return conf;
    const lb = LISTY.test(b.from) ? 1 : 0;
    const la = LISTY.test(a.from) ? 1 : 0;
    if (lb !== la) return lb - la;
    return a.from.localeCompare(b.from);
  });
}

// ── Levenshtein for fuzzy slug suggestions ──────────────────────────────────
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let cur = new Array(n + 1);
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[n];
}

function nearMatches(slug, limit = 6) {
  const q = slug.toUpperCase();
  const subs = [];
  for (const id of NODES.keys()) if (id.includes(q)) subs.push(id);
  if (subs.length) return subs.slice(0, limit);
  return [...NODES.keys()]
    .map((id) => ({ id, d: levenshtein(q, id) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, limit)
    .map((x) => x.id);
}

// ── Plan model ──────────────────────────────────────────────────────────────
// Resolve one param into a plan entry: how is its value acquired?
function planParam(toolId, param, depth, seen) {
  const acq = param.acquisition;
  const entry = {
    name: param.name,
    type: param.type,
    required: !!param.required,
    entity_type: param.entity_type ?? null,
    acquisition: acq,
    description: param.description ?? "",
  };

  if (acq === "user") {
    entry.strategy = "ask_user";
    return entry;
  }

  // dependency or either -> look for producers
  const producers = rankProducers(producersFor(toolId, param.name));
  entry.producers = producers.map((e) => ({
    from: e.from,
    kind: e.kind,
    source_path: e.source_path,
    confidence: e.confidence ?? null,
  }));

  if (producers.length === 0) {
    // either with no resolver still collapses to "ask user"; dependency w/o
    // producer is a dead-end we must surface honestly.
    entry.strategy = acq === "either" ? "ask_user" : "unresolved_dependency";
    entry.recommended = null;
    return entry;
  }

  const best = producers[0];
  entry.recommended = best.from;
  entry.alternatives = producers.length - 1;
  entry.strategy = acq === "either" ? "ask_user_or_resolve" : "tool_call";

  // recurse into the recommended producer's own required params
  if (depth > 1) {
    if (seen.has(best.from)) {
      entry.recommended_subplan = { tool: best.from, cycle: true };
    } else {
      const child = NODES.get(best.from);
      if (child) {
        const nextSeen = new Set(seen).add(best.from);
        entry.recommended_subplan = buildPlan(best.from, depth - 1, nextSeen);
      }
    }
  }
  return entry;
}

function buildPlan(toolId, depth, seen = new Set([toolId])) {
  const node = NODES.get(toolId);
  const required = node.params.filter((p) => p.required);
  const optionalTyped = node.params.filter(
    (p) => !p.required && p.entity_type
  );
  return {
    tool: toolId,
    name: node.name,
    toolkit: node.toolkit,
    description: node.description,
    required: required.map((p) => planParam(toolId, p, depth, seen)),
    optional: optionalTyped.map((p) => planParam(toolId, p, 1, seen)),
  };
}

// ── Summary counters ────────────────────────────────────────────────────────
function summarize(plan) {
  let user = 0, tool = 0, either = 0;
  for (const p of plan.required) {
    if (p.strategy === "ask_user" || p.strategy === "unresolved_dependency")
      user++;
    else if (p.strategy === "tool_call") tool++;
    else if (p.strategy === "ask_user_or_resolve") either++;
  }
  return { params: plan.required.length, user, tool, either };
}

// ── Pretty (ANSI tree) renderer ─────────────────────────────────────────────
function kindBadge(kind) {
  const label = { id_lookup: "id-lookup", resolver: "resolver", creator: "creator" }[kind] ?? kind;
  const col = { id_lookup: c.green, resolver: c.cyan, creator: c.yellow }[kind] ?? c.gray;
  return col(label);
}

function confBadge(conf) {
  if (conf == null) return "";
  const pct = `${Math.round(conf * 100)}%`;
  const col = conf >= 0.9 ? c.green : conf >= 0.75 ? c.yellow : c.red;
  return col(pct);
}

function renderParamLines(p, prefix, isLast, out) {
  const branch = isLast ? "└─ " : "├─ ";
  const cont = isLast ? "   " : "│  ";
  const etype = p.entity_type ? c.dim(` :${p.entity_type}`) : "";
  const nameCol = c.bold(p.name);

  if (p.strategy === "ask_user") {
    out.push(`${prefix}${branch}${nameCol}${etype}  ${c.magenta("● ask the user")}`);
    return;
  }
  if (p.strategy === "unresolved_dependency") {
    out.push(`${prefix}${branch}${nameCol}${etype}  ${c.red("● no producer found — must ask user")}`);
    return;
  }

  const verb =
    p.strategy === "ask_user_or_resolve"
      ? c.magenta("● ask the user ") + c.dim("OR") + c.blue(" resolve via:")
      : c.blue("● run a tool first:");
  out.push(`${prefix}${branch}${nameCol}${etype}  ${verb}`);

  const top = p.producers[0];
  const altNote =
    p.alternatives > 0 ? c.dim(`  (+${p.alternatives} alt${p.alternatives > 1 ? "s" : ""})`) : "";
  out.push(
    `${prefix}${cont}${c.green("→")} ${c.bold(top.from)}  ` +
      `[${kindBadge(top.kind)} ${confBadge(top.confidence)}]` +
      altNote
  );
  out.push(`${prefix}${cont}  ${c.gray("emits " + top.source_path)}`);

  // recursive subplan
  if (p.recommended_subplan) {
    const sp = p.recommended_subplan;
    if (sp.cycle) {
      out.push(`${prefix}${cont}  ${c.red("↻ " + sp.tool + " (cycle — stop)")}`);
    } else if (sp.required && sp.required.length) {
      out.push(`${prefix}${cont}  ${c.dim(sp.tool + " needs:")}`);
      sp.required.forEach((cp, i) =>
        renderParamLines(cp, prefix + cont + "  ", i === sp.required.length - 1, out)
      );
    }
  }
}

function renderPretty(plan, depth) {
  const out = [];
  const sum = summarize(plan);
  out.push("");
  out.push(
    `${c.bold(c.cyan(plan.tool))}  ${c.dim(plan.toolkit)}`
  );
  out.push(`${c.dim(plan.name + " — " + (plan.description || "").split(". ")[0])}`);
  out.push("");
  out.push(c.bold(`Execution plan  ${c.dim(`(depth ${depth})`)}`));
  out.push(c.dim("Required inputs:"));

  if (plan.required.length === 0) {
    out.push(`  ${c.dim("(no required params)")}`);
  } else {
    plan.required.forEach((p, i) =>
      renderParamLines(p, "  ", i === plan.required.length - 1, out)
    );
  }

  if (plan.optional.length) {
    out.push("");
    out.push(c.dim(`Optional inputs with resolvable entity types (${plan.optional.length}):`));
    plan.optional.forEach((p, i) =>
      renderParamLines(p, "  ", i === plan.optional.length - 1, out)
    );
  }

  out.push("");
  out.push(
    c.bold("Summary  ") +
      `${sum.params} param${sum.params === 1 ? "" : "s"}: ` +
      `${c.magenta(sum.user + " from user")}, ` +
      `${c.blue(sum.tool + " via tool calls")}, ` +
      `${c.cyan(sum.either + " either")}`
  );
  out.push("");
  return out.join("\n");
}

// ── CLI ─────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = { positional: [], depth: 1, json: false, list: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") args.json = true;
    else if (a === "--depth") args.depth = parseInt(argv[++i], 10);
    else if (a === "--list") args.list = argv[++i] ?? "";
    else if (a === "-h" || a === "--help") args.help = true;
    else args.positional.push(a);
  }
  if (!Number.isFinite(args.depth)) args.depth = 1;
  args.depth = Math.max(1, Math.min(3, args.depth));
  return args;
}

const HELP = `${c.bold("plan.mjs")} — Composio tool dependency planner

${c.bold("Usage:")}
  node scripts/plan.mjs <TOOL_SLUG>            plan for one tool
  node scripts/plan.mjs <TOOL_SLUG> --depth 2  recurse into producers (1-3, default 1)
  node scripts/plan.mjs <TOOL_SLUG> --json     structured plan (agent-facing)
  node scripts/plan.mjs --list <substring>     find tool slugs

Answers: before running a tool, what do we ask the user vs which tools run first.
`;

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    process.stdout.write(HELP + "\n");
    return;
  }

  // --list mode
  if (args.list !== null) {
    const q = args.list.toUpperCase();
    const hits = [...NODES.values()]
      .filter((n) => n.id.includes(q) || (n.name ?? "").toUpperCase().includes(q))
      .sort((a, b) => a.id.localeCompare(b.id));
    if (!hits.length) {
      process.stdout.write(c.yellow(`No tools match "${args.list}".\n`));
      process.exit(1);
    }
    if (args.json) {
      process.stdout.write(
        JSON.stringify(hits.map((n) => ({ id: n.id, name: n.name, toolkit: n.toolkit })), null, 2) + "\n"
      );
      return;
    }
    process.stdout.write(`\n${c.bold(hits.length + " match" + (hits.length === 1 ? "" : "es"))} for ${c.cyan(args.list)}:\n`);
    for (const n of hits) {
      process.stdout.write(`  ${c.bold(n.id)}  ${c.dim(n.toolkit + " · " + n.name)}\n`);
    }
    process.stdout.write("\n");
    return;
  }

  const slug = (args.positional[0] ?? "").toUpperCase();
  if (!slug) {
    process.stdout.write(HELP + "\n");
    process.exit(1);
  }

  // Validate slug
  if (!NODES.has(slug)) {
    const near = nearMatches(slug);
    if (args.json) {
      process.stdout.write(
        JSON.stringify({ error: "unknown_tool", slug, suggestions: near }, null, 2) + "\n"
      );
      process.exit(1);
    }
    process.stderr.write(`\n${c.red("✗")} Unknown tool: ${c.bold(slug)}\n`);
    if (near.length) {
      process.stderr.write(c.dim("Did you mean:\n"));
      for (const id of near) process.stderr.write(`  ${c.cyan(id)}\n`);
    }
    process.stderr.write(`\n${c.dim("Tip: node scripts/plan.mjs --list <substring>")}\n\n`);
    process.exit(1);
  }

  const plan = buildPlan(slug, args.depth);

  if (args.json) {
    const out = { ...plan, depth: args.depth, summary: summarize(plan) };
    process.stdout.write(JSON.stringify(out, null, 2) + "\n");
    return;
  }

  process.stdout.write(renderPretty(plan, args.depth) + "\n");
}

main();
