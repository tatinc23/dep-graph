#!/usr/bin/env node
// eval.mjs — Node 22 ESM, zero dependencies
// Usage: node scripts/eval.mjs [path/to/graph.json]
//   Default: data/graph.json, fallback: data/graph.stub.json

import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join, resolve } from "path";

const __dir = dirname(fileURLToPath(import.meta.url));
const root = join(__dir, "..");

// ─── resolve graph path ──────────────────────────────────────────────────────
let graphPath;
const arg = process.argv[2];
if (arg) {
  graphPath = resolve(arg);
} else {
  const primary = join(root, "data", "graph.json");
  const fallback = join(root, "data", "graph.stub.json");
  graphPath = existsSync(primary) ? primary : fallback;
}

if (!existsSync(graphPath)) {
  console.error(`ERROR: graph file not found: ${graphPath}`);
  process.exit(1);
}

const isFallback = graphPath.endsWith("graph.stub.json");
console.log(`\nLoading: ${graphPath}${isFallback ? "  [STUB MODE]" : ""}`);

let graph;
try {
  graph = JSON.parse(readFileSync(graphPath, "utf8"));
} catch (e) {
  console.error(`ERROR: failed to parse graph JSON: ${e.message}`);
  process.exit(1);
}

// ─── schema validation ───────────────────────────────────────────────────────
const schemaErrors = [];
if (!graph.meta) schemaErrors.push("missing graph.meta");
if (!Array.isArray(graph.entity_types)) schemaErrors.push("missing graph.entity_types array");
if (!Array.isArray(graph.nodes)) schemaErrors.push("missing graph.nodes array");
if (!Array.isArray(graph.edges)) schemaErrors.push("missing graph.edges array");

if (schemaErrors.length) {
  console.error("SCHEMA VIOLATIONS:");
  for (const e of schemaErrors) console.error("  " + e);
  process.exit(1);
}

// ─── build lookup maps ───────────────────────────────────────────────────────
const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
const entityTypeById = new Map(graph.entity_types.map((e) => [e.id, e]));

// edges grouped by consumer node + param
const edgesByConsumerParam = new Map(); // "NODE:param" -> edge[]
for (const e of graph.edges) {
  const key = `${e.to}:${e.param}`;
  if (!edgesByConsumerParam.has(key)) edgesByConsumerParam.set(key, []);
  edgesByConsumerParam.get(key).push(e);
}

// all producer slugs for each consumer+param
function producersFor(consumerSlug, param) {
  return (edgesByConsumerParam.get(`${consumerSlug}:${param}`) || []).map(
    (e) => e.from
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PART A: GROUND TRUTH SUITE
// Each case is derived by reading the raw tool data.
// Fields:
//   id            - short label
//   consumer_slug - the consuming tool
//   param         - the parameter that needs to be produced
//   expect_producers_include - at least one of these must appear as a producer
//   expect_acquisition        - optional: expected acquisition value on the param
//   kind_any      - optional: at least one edge must have this kind
//   note          - human rationale
// ─────────────────────────────────────────────────────────────────────────────
const GT_CASES = [
  // ── GOOGLESUPER: thread_id flows ─────────────────────────────────────────
  {
    id: "GT-01",
    consumer_slug: "GOOGLESUPER_REPLY_TO_THREAD",
    param: "thread_id",
    expect_producers_include: ["GOOGLESUPER_LIST_THREADS"],
    expect_acquisition: "dependency",
    kind_any: "id_lookup",
    note: "README example: LIST_THREADS produces thread_id consumed by REPLY_TO_THREAD",
  },
  {
    id: "GT-02",
    consumer_slug: "GOOGLESUPER_REPLY_TO_THREAD",
    param: "thread_id",
    expect_producers_include: ["GOOGLESUPER_FETCH_EMAILS"],
    expect_acquisition: "dependency",
    note: "FETCH_EMAILS.data.messages[].threadId is a second thread_id producer",
  },
  {
    id: "GT-03",
    consumer_slug: "GOOGLESUPER_FETCH_MESSAGE_BY_THREAD_ID",
    param: "thread_id",
    expect_producers_include: ["GOOGLESUPER_LIST_THREADS"],
    expect_acquisition: "dependency",
    note: "Fetching messages by thread also needs a thread_id from LIST_THREADS",
  },
  {
    id: "GT-04",
    consumer_slug: "GOOGLESUPER_MODIFY_THREAD_LABELS",
    param: "thread_id",
    expect_producers_include: ["GOOGLESUPER_LIST_THREADS", "GOOGLESUPER_FETCH_EMAILS"],
    expect_acquisition: "dependency",
    note: "MODIFY_THREAD_LABELS.thread_id is opaque — must come from listing/fetching",
  },

  // ── GOOGLESUPER: email address / resolver flows ───────────────────────────
  {
    id: "GT-05",
    consumer_slug: "GOOGLESUPER_SEND_EMAIL",
    param: "recipient_email",
    expect_producers_include: ["GOOGLESUPER_SEARCH_PEOPLE"],
    expect_acquisition: "either",
    kind_any: "resolver",
    note: "README example: SEARCH_PEOPLE resolves name -> email for SEND_EMAIL",
  },
  {
    id: "GT-06",
    consumer_slug: "GOOGLESUPER_SEND_EMAIL",
    param: "recipient_email",
    expect_producers_include: ["GOOGLESUPER_GET_PEOPLE"],
    expect_acquisition: "either",
    note: "GET_PEOPLE is an additional resolver for recipient email",
  },
  {
    id: "GT-07",
    consumer_slug: "GOOGLESUPER_REPLY_TO_THREAD",
    param: "recipient_email",
    expect_producers_include: ["GOOGLESUPER_SEARCH_PEOPLE"],
    expect_acquisition: "either",
    kind_any: "resolver",
    note: "REPLY_TO_THREAD also requires recipient_email, resolvable via SEARCH_PEOPLE",
  },
  {
    id: "GT-08",
    consumer_slug: "GOOGLESUPER_CREATE_EMAIL_DRAFT",
    param: "recipient_email",
    expect_producers_include: ["GOOGLESUPER_SEARCH_PEOPLE"],
    expect_acquisition: "either",
    note: "Creating a draft requires recipient_email — contacts search can resolve it",
  },

  // ── GOOGLESUPER: message_id flows ────────────────────────────────────────
  {
    id: "GT-09",
    consumer_slug: "GOOGLESUPER_DELETE_MESSAGE",
    param: "message_id",
    expect_producers_include: ["GOOGLESUPER_FETCH_EMAILS"],
    expect_acquisition: "dependency",
    kind_any: "id_lookup",
    note: "DELETE_MESSAGE.message_id must come from FETCH_EMAILS.data.messages[].messageId",
  },
  {
    id: "GT-10",
    consumer_slug: "GOOGLESUPER_FORWARD_MESSAGE",
    param: "message_id",
    expect_producers_include: ["GOOGLESUPER_FETCH_EMAILS"],
    expect_acquisition: "dependency",
    note: "FORWARD_MESSAGE.message_id produced by FETCH_EMAILS",
  },
  {
    id: "GT-11",
    consumer_slug: "GOOGLESUPER_ADD_LABEL_TO_EMAIL",
    param: "message_id",
    expect_producers_include: [
      "GOOGLESUPER_FETCH_EMAILS",
      "GOOGLESUPER_FETCH_MESSAGE_BY_THREAD_ID",
    ],
    expect_acquisition: "dependency",
    note: "ADD_LABEL_TO_EMAIL.message_id: from fetch_emails or fetch_by_thread",
  },
  {
    id: "GT-12",
    consumer_slug: "GOOGLESUPER_FETCH_MESSAGE_BY_MESSAGE_ID",
    param: "message_id",
    expect_producers_include: ["GOOGLESUPER_FETCH_EMAILS"],
    expect_acquisition: "dependency",
    note: "Getting a message by its ID — that ID must come from a prior list/fetch",
  },

  // ── GOOGLESUPER: label_id creator flow ──────────────────────────────────
  {
    id: "GT-13",
    consumer_slug: "GOOGLESUPER_ADD_LABEL_TO_EMAIL",
    param: "add_label_ids",
    expect_producers_include: ["GOOGLESUPER_CREATE_LABEL", "GOOGLESUPER_LIST_LABELS"],
    expect_acquisition: "dependency",
    kind_any: "creator",
    note: "CREATOR edge: CREATE_LABEL produces label_id consumed by ADD_LABEL_TO_EMAIL",
  },

  // ── GOOGLESUPER: Drive file_id flows ────────────────────────────────────
  {
    id: "GT-14",
    consumer_slug: "GOOGLESUPER_DOWNLOAD_FILE",
    param: "file_id",
    expect_producers_include: ["GOOGLESUPER_FIND_FILE"],
    expect_acquisition: "dependency",
    kind_any: "id_lookup",
    note: "FIND_FILE.data.files[].id provides file_id for DOWNLOAD_FILE",
  },
  {
    id: "GT-15",
    consumer_slug: "GOOGLESUPER_EDIT_FILE",
    param: "file_id",
    expect_producers_include: ["GOOGLESUPER_FIND_FILE", "GOOGLESUPER_CREATE_FILE"],
    expect_acquisition: "dependency",
    note: "EDIT_FILE.file_id: FIND_FILE (id_lookup) or CREATE_FILE (creator) provide it",
  },
  {
    id: "GT-16",
    consumer_slug: "GOOGLESUPER_COPY_FILE",
    param: "file_id",
    expect_producers_include: ["GOOGLESUPER_FIND_FILE"],
    expect_acquisition: "dependency",
    note: "COPY_FILE.file_id comes from FIND_FILE (search result)",
  },
  {
    id: "GT-17",
    consumer_slug: "GOOGLESUPER_MOVE_FILE",
    param: "file_id",
    expect_producers_include: ["GOOGLESUPER_FIND_FILE"],
    expect_acquisition: "dependency",
    note: "MOVE_FILE.file_id requires locating the file first with FIND_FILE",
  },

  // ── GOOGLESUPER: Calendar event_id flows ───────────────────────────────
  {
    id: "GT-18",
    consumer_slug: "GOOGLESUPER_DELETE_EVENT",
    param: "event_id",
    expect_producers_include: ["GOOGLESUPER_FIND_EVENT", "GOOGLESUPER_EVENTS_LIST"],
    expect_acquisition: "dependency",
    kind_any: "id_lookup",
    note: "DELETE_EVENT.event_id from FIND_EVENT or EVENTS_LIST results",
  },
  {
    id: "GT-19",
    consumer_slug: "GOOGLESUPER_UPDATE_EVENT",
    param: "event_id",
    expect_producers_include: ["GOOGLESUPER_FIND_EVENT"],
    expect_acquisition: "dependency",
    note: "UPDATE_EVENT.event_id must be looked up before updating",
  },

  // ── GOOGLESUPER: Drive drive_id flows ──────────────────────────────────
  {
    id: "GT-20",
    consumer_slug: "GOOGLESUPER_GET_DRIVE",
    param: "drive_id",
    expect_producers_include: ["GOOGLESUPER_LIST_SHARED_DRIVES", "GOOGLESUPER_CREATE_DRIVE"],
    expect_acquisition: "dependency",
    note: "GET_DRIVE.drive_id: LIST_SHARED_DRIVES (id_lookup) or CREATE_DRIVE (creator)",
  },

  // ── GITHUB: issue_number flows ──────────────────────────────────────────
  {
    id: "GT-21",
    consumer_slug: "GITHUB_GET_AN_ISSUE",
    param: "issue_number",
    expect_producers_include: [
      "GITHUB_ISSUES_LIST_FOR_REPO",
      "GITHUB_SEARCH_ISSUES_AND_PULL_REQUESTS",
    ],
    expect_acquisition: "dependency",
    kind_any: "id_lookup",
    note: "README: issue_number for GET_AN_ISSUE comes from listing/searching issues",
  },
  {
    id: "GT-22",
    consumer_slug: "GITHUB_UPDATE_AN_ISSUE",
    param: "issue_number",
    expect_producers_include: [
      "GITHUB_ISSUES_LIST_FOR_REPO",
      "GITHUB_SEARCH_ISSUES_AND_PULL_REQUESTS",
    ],
    expect_acquisition: "dependency",
    note: "UPDATE_AN_ISSUE.issue_number must come from list/search issues",
  },
  {
    id: "GT-23",
    consumer_slug: "GITHUB_CREATE_AN_ISSUE_COMMENT",
    param: "issue_number",
    expect_producers_include: ["GITHUB_ISSUES_LIST_FOR_REPO"],
    expect_acquisition: "dependency",
    note: "Commenting on an issue requires knowing the issue_number from a list",
  },

  // ── GITHUB: pull_number flows ──────────────────────────────────────────
  {
    id: "GT-24",
    consumer_slug: "GITHUB_MERGE_A_PULL_REQUEST",
    param: "pull_number",
    expect_producers_include: ["GITHUB_LIST_PULL_REQUESTS", "GITHUB_FIND_PULL_REQUESTS"],
    expect_acquisition: "dependency",
    kind_any: "id_lookup",
    note: "MERGE_PR.pull_number: list pull requests first",
  },
  {
    id: "GT-25",
    consumer_slug: "GITHUB_CREATE_A_REVIEW_COMMENT_FOR_A_PULL_REQUEST",
    param: "pull_number",
    expect_producers_include: ["GITHUB_LIST_PULL_REQUESTS"],
    expect_acquisition: "dependency",
    note: "Reviewing a PR requires pull_number from listing PRs",
  },

  // ── GITHUB: release_id / gist_id / sha flows ──────────────────────────
  {
    id: "GT-26",
    consumer_slug: "GITHUB_GET_A_RELEASE",
    param: "release_id",
    expect_producers_include: ["GITHUB_LIST_RELEASES"],
    expect_acquisition: "dependency",
    kind_any: "id_lookup",
    note: "GET_A_RELEASE.release_id from LIST_RELEASES",
  },
  {
    id: "GT-27",
    consumer_slug: "GITHUB_GET_A_GIST",
    param: "gist_id",
    expect_producers_include: [
      "GITHUB_LIST_GISTS_FOR_THE_AUTHENTICATED_USER",
      "GITHUB_CREATE_A_GIST",
    ],
    expect_acquisition: "dependency",
    note: "GET_A_GIST.gist_id: list gists (id_lookup) or create gist (creator)",
  },
  {
    id: "GT-28",
    consumer_slug: "GITHUB_UPDATE_A_GIST",
    param: "gist_id",
    expect_producers_include: ["GITHUB_LIST_GISTS_FOR_THE_AUTHENTICATED_USER"],
    expect_acquisition: "dependency",
    note: "UPDATE_A_GIST.gist_id from listing authenticated user gists",
  },
  {
    id: "GT-29",
    consumer_slug: "GITHUB_GET_A_BLOB",
    param: "file_sha",
    expect_producers_include: ["GITHUB_GET_A_COMMIT", "GITHUB_LIST_COMMITS"],
    expect_acquisition: "dependency",
    kind_any: "id_lookup",
    note: "GET_A_BLOB.file_sha is a commit SHA resolved from listing or fetching commits",
  },
];

// ─── run GT suite ────────────────────────────────────────────────────────────
console.log("\n" + "═".repeat(70));
console.log("PART A — GROUND TRUTH SUITE");
console.log("═".repeat(70));

let gtPass = 0;
let gtFail = 0;
let gtInvalid = 0;
const allSlugs = new Set([...nodeById.keys()]);

for (const tc of GT_CASES) {
  const errors = [];

  // check slugs exist in this graph
  const missingSlug = !nodeById.has(tc.consumer_slug);
  const missingProducers = tc.expect_producers_include.filter(
    (s) => !allSlugs.has(s)
  );
  if (missingSlug || missingProducers.length > 0) {
    const what = [
      missingSlug ? `consumer ${tc.consumer_slug}` : null,
      ...missingProducers.map((s) => `producer ${s}`),
    ]
      .filter(Boolean)
      .join(", ");
    console.log(
      `  [INVALID] ${tc.id}: slug(s) not in graph nodes — ${what} | ${tc.note}`
    );
    gtInvalid++;
    continue;
  }

  // check consumer param exists
  const consumerNode = nodeById.get(tc.consumer_slug);
  const paramDef = (consumerNode.params || []).find(
    (p) => p.name === tc.param
  );
  if (!paramDef) {
    errors.push(`param "${tc.param}" not found in node ${tc.consumer_slug}`);
  } else if (tc.expect_acquisition && paramDef.acquisition !== tc.expect_acquisition) {
    errors.push(
      `param acquisition: expected "${tc.expect_acquisition}", got "${paramDef.acquisition}"`
    );
  }

  // check at least one expected producer has an edge
  const actualProducers = producersFor(tc.consumer_slug, tc.param);
  const producerHit = tc.expect_producers_include.some((s) =>
    actualProducers.includes(s)
  );
  if (!producerHit) {
    errors.push(
      `no edge from any of [${tc.expect_producers_include.join(", ")}] -> ${tc.consumer_slug}:${tc.param} (actual producers: [${actualProducers.join(", ")}])`
    );
  }

  // check kind constraint if specified
  if (tc.kind_any && producerHit) {
    const edges = edgesByConsumerParam.get(`${tc.consumer_slug}:${tc.param}`) || [];
    const hasKind = edges.some(
      (e) => e.kind === tc.kind_any && tc.expect_producers_include.includes(e.from)
    );
    if (!hasKind) {
      errors.push(
        `expected at least one edge of kind "${tc.kind_any}" from [${tc.expect_producers_include.join(", ")}]`
      );
    }
  }

  if (errors.length === 0) {
    console.log(`  [PASS] ${tc.id}: ${tc.note}`);
    gtPass++;
  } else {
    console.log(`  [FAIL] ${tc.id}: ${tc.note}`);
    for (const err of errors) console.log(`         -> ${err}`);
    gtFail++;
  }
}

const gtTotal = gtPass + gtFail + gtInvalid;
console.log(
  `\nGround Truth: ${gtPass} passed, ${gtFail} failed, ${gtInvalid} invalid (slug not in graph) — ${gtTotal} total\n`
);

// ─────────────────────────────────────────────────────────────────────────────
// PART B: STRUCTURAL METRICS
// ─────────────────────────────────────────────────────────────────────────────
console.log("═".repeat(70));
console.log("PART B — STRUCTURAL METRICS");
console.log("═".repeat(70));

// ── 1. edge sanity ────────────────────────────────────────────────────────
console.log("\n[1] Edge sanity checks");
const sanityViolations = [];
for (const [i, e] of graph.edges.entries()) {
  const prefix = `edge[${i}] ${e.from} -> ${e.to}:${e.param}`;
  if (!nodeById.has(e.from)) {
    sanityViolations.push(`${prefix}: from-node "${e.from}" not in nodes`);
  }
  if (!nodeById.has(e.to)) {
    sanityViolations.push(`${prefix}: to-node "${e.to}" not in nodes`);
  }
  if (!e.source_path || e.source_path.trim() === "") {
    sanityViolations.push(`${prefix}: source_path is empty`);
  }
  if (!e.entity_type) {
    sanityViolations.push(`${prefix}: entity_type is missing`);
  }
  // check producer's produces[] contains the entity_type
  const fromNode = nodeById.get(e.from);
  if (fromNode) {
    const produces = fromNode.produces || [];
    const hasEntityType = produces.some((p) => p.entity_type === e.entity_type);
    if (!hasEntityType) {
      sanityViolations.push(
        `${prefix}: producer "${e.from}" produces[] does not list entity_type "${e.entity_type}"`
      );
    }
  }
}

if (sanityViolations.length === 0) {
  console.log("  All edges pass sanity checks.");
} else {
  for (const v of sanityViolations) console.log("  VIOLATION: " + v);
}

// ── 2. self-loop count ────────────────────────────────────────────────────
const selfLoops = graph.edges.filter((e) => e.from === e.to);
console.log(`\n[2] Self-loops: ${selfLoops.length}`);
if (selfLoops.length > 0) {
  for (const sl of selfLoops)
    console.log(`  SELF-LOOP: ${sl.from} -> ${sl.to}:${sl.param}`);
}

// ── 3. resolution coverage ───────────────────────────────────────────────
// A param is "dependency-class" if entity_type != null AND acquisition is dependency or either
console.log("\n[3] Resolution coverage");
let depParamCount = 0;
let depParamCovered = 0;
const uncoveredParams = [];
for (const node of graph.nodes) {
  for (const param of node.params || []) {
    if (
      param.entity_type &&
      (param.acquisition === "dependency" || param.acquisition === "either")
    ) {
      depParamCount++;
      const producers = producersFor(node.id, param.name);
      if (producers.length > 0) {
        depParamCovered++;
      } else {
        uncoveredParams.push({ node: node.id, param: param.name, acq: param.acquisition, et: param.entity_type });
      }
    }
  }
}
const coveragePct =
  depParamCount > 0
    ? ((depParamCovered / depParamCount) * 100).toFixed(1)
    : "N/A";
console.log(
  `  ${depParamCovered}/${depParamCount} dependency-class params have at least one incoming edge (${coveragePct}%)`
);

// ── 4. orphan ids ─────────────────────────────────────────────────────────
console.log("\n[4] Orphan dependency params (no producer edges) — top 15:");
if (uncoveredParams.length === 0) {
  console.log("  None.");
} else {
  const top15 = uncoveredParams.slice(0, 15);
  for (const u of top15)
    console.log(`  ${u.node}.${u.param}  [${u.et}]  acq=${u.acq}`);
  if (uncoveredParams.length > 15)
    console.log(`  ... and ${uncoveredParams.length - 15} more`);
}

// ── 5. fan-in distribution ────────────────────────────────────────────────
console.log("\n[5] Fan-in distribution by entity_type");
const fanInByType = new Map(); // entity_type -> edge count
for (const e of graph.edges) {
  const et = e.entity_type || "<unknown>";
  fanInByType.set(et, (fanInByType.get(et) || 0) + 1);
}
const sortedFanIn = [...fanInByType.entries()].sort((a, b) => b[1] - a[1]);
const PATHOLOGICAL = 200;
let pathologicalCount = 0;
for (const [et, count] of sortedFanIn.slice(0, 20)) {
  const flag = count > PATHOLOGICAL ? "  *** PATHOLOGICAL ***" : "";
  console.log(`  ${et}: ${count} edges${flag}`);
  if (count > PATHOLOGICAL) pathologicalCount++;
}
if (sortedFanIn.length > 20) {
  console.log(`  ... (${sortedFanIn.length - 20} more entity types)`);
}
if (pathologicalCount > 0) {
  console.log(
    `\n  WARNING: ${pathologicalCount} entity type(s) have > ${PATHOLOGICAL} edges (likely over-broad typing)`
  );
}

// ─── summary line ─────────────────────────────────────────────────────────
const sanityCount = sanityViolations.length + selfLoops.length;
console.log("\n" + "═".repeat(70));
console.log(
  `GT: ${gtPass}/${gtTotal - gtInvalid} passed | coverage: ${coveragePct}% | sanity violations: ${sanityCount}`
);
console.log("═".repeat(70) + "\n");

// Non-zero exit only on schema or sanity violations
if (sanityViolations.length > 0) {
  process.exit(2);
}
