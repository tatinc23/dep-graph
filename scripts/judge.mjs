#!/usr/bin/env node
// judge.mjs — LLM-judge precision evaluation for tool dependency graph
// Node 22 ESM, stdlib only (except fetch which is built-in since Node 18)
// Usage: node scripts/judge.mjs [--seed <n>] [--batch-size <n>] [--sample-size <n>]

import { readFileSync, writeFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, "..");

// ─── CLI args ─────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
let seed = 42;
let batchSize = 10;
let sampleSize = 100;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--seed" && args[i + 1]) seed = parseInt(args[++i]);
  if (args[i] === "--batch-size" && args[i + 1]) batchSize = parseInt(args[++i]);
  if (args[i] === "--sample-size" && args[i + 1]) sampleSize = parseInt(args[++i]);
}

console.log(`\n=== LLM-Judge Precision Eval (seed=${seed}, sample=${sampleSize}, batch=${batchSize}) ===\n`);

// ─── Load .env ────────────────────────────────────────────────────────────────
function loadEnv() {
  const envPath = join(ROOT, ".env");
  if (!existsSync(envPath)) return;
  const lines = readFileSync(envPath, "utf8").split("\n");
  for (const line of lines) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim();
  }
}
loadEnv();

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
if (!OPENROUTER_API_KEY) {
  console.error("ERROR: OPENROUTER_API_KEY not set in .env");
  process.exit(1);
}

// ─── Load graph ───────────────────────────────────────────────────────────────
const graphPath = join(ROOT, "data", "graph.json");
const graph = JSON.parse(readFileSync(graphPath, "utf8"));
const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));

// ─── Seeded PRNG (mulberry32) ─────────────────────────────────────────────────
function mulberry32(seed) {
  let s = seed >>> 0;
  return function () {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─── Stratified sampling ──────────────────────────────────────────────────────
function stratifiedSample(edges, n, rng) {
  // Group edges by entity_type
  const groups = new Map();
  for (const e of edges) {
    const key = e.entity_type;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }

  const types = [...groups.keys()];
  const numTypes = types.length;

  // Floor: min 2 per type until budget exhausted
  const floor = 2;
  const floored = Math.min(n, numTypes * floor);
  const floorPerType = floor;

  // Allocate proportionally for the remainder
  // First allocate floor to each type, then distribute remainder proportionally
  const totalEdges = edges.length;
  const allocations = new Map();

  // Phase 1: give floor to each type (but don't exceed group size)
  let used = 0;
  for (const type of types) {
    const alloc = Math.min(floorPerType, groups.get(type).length);
    allocations.set(type, alloc);
    used += alloc;
  }

  // Phase 2: distribute remaining budget proportionally
  let remaining = n - used;
  if (remaining > 0) {
    // proportional weights based on group size
    const proportions = types.map((t) => ({
      type: t,
      extra: Math.max(0, groups.get(t).length - (allocations.get(t) || 0)),
    }));
    const totalExtra = proportions.reduce((s, p) => s + p.extra, 0);

    if (totalExtra > 0) {
      // Sort by extra desc to avoid rounding losses
      proportions.sort((a, b) => b.extra - a.extra);
      let distributed = 0;
      for (const p of proportions) {
        if (distributed >= remaining) break;
        const share = Math.min(
          Math.round((p.extra / totalExtra) * remaining),
          p.extra,
          remaining - distributed
        );
        allocations.set(p.type, (allocations.get(p.type) || 0) + share);
        distributed += share;
      }
      // Fill any rounding gap with the largest group
      let stillLeft = remaining - distributed;
      for (const p of proportions) {
        if (stillLeft <= 0) break;
        const cur = allocations.get(p.type) || 0;
        const available = groups.get(p.type).length - cur;
        const give = Math.min(stillLeft, available);
        allocations.set(p.type, cur + give);
        stillLeft -= give;
      }
    }
  }

  // Phase 3: shuffle each group with seeded PRNG and take allocation
  const sampled = [];
  for (const type of types) {
    const group = [...groups.get(type)];
    // Fisher-Yates with seeded rng
    for (let i = group.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [group[i], group[j]] = [group[j], group[i]];
    }
    const take = allocations.get(type) || 0;
    for (let i = 0; i < take; i++) {
      sampled.push(group[i]);
    }
  }

  // Shuffle final sample so ordering isn't by type
  for (let i = sampled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [sampled[i], sampled[j]] = [sampled[j], sampled[i]];
  }

  return sampled;
}

// ─── Build judgment payload ───────────────────────────────────────────────────
function buildPayload(edge) {
  const producer = nodeById.get(edge.from);
  const consumer = nodeById.get(edge.to);
  const param = consumer?.params?.find((p) => p.name === edge.param);

  return {
    id: `${edge.from}||${edge.to}||${edge.param}||${seed}`,
    producer_slug: edge.from,
    producer_desc: (producer?.description || "").slice(0, 200).trim(),
    consumer_slug: edge.to,
    consumer_desc: (consumer?.description || "").slice(0, 200).trim(),
    param_name: edge.param,
    param_desc: (param?.description || "").slice(0, 200).trim(),
    entity_type: edge.entity_type,
    kind: edge.kind,
    source_path: edge.source_path || "",
    confidence: edge.confidence,
  };
}

// ─── Cache ────────────────────────────────────────────────────────────────────
const cachePath = join(ROOT, "data", "judge-cache.json");
let cache = {};
if (existsSync(cachePath)) {
  try {
    cache = JSON.parse(readFileSync(cachePath, "utf8"));
  } catch {
    cache = {};
  }
}

function saveCache() {
  writeFileSync(cachePath, JSON.stringify(cache, null, 2));
}

// ─── OpenRouter call ──────────────────────────────────────────────────────────
async function callLLM(batch, attempt = 0) {
  const systemPrompt = `You are a precise semantic dependency evaluator for tool orchestration graphs.
For each edge in the batch, determine if the PRODUCER tool genuinely yields a value that can be used as the CONSUMER tool's PARAM.
Judge SEMANTICS: would running PRODUCER plausibly return a value usable as CONSUMER's PARAM in a real workflow?
DO NOT judge formatting, naming conventions, or graph structure — only whether the dependency makes semantic sense.

Respond ONLY with a valid JSON array (no markdown, no commentary) where each element has:
  { "id": "<same id from input>", "valid": true|false, "reason": "<max 15 words>" }`;

  const userPrompt = `Judge these ${batch.length} dependency edges:\n\n${JSON.stringify(
    batch.map((p) => ({
      id: p.id,
      producer: `[${p.producer_slug}] ${p.producer_desc}`,
      consumer: `[${p.consumer_slug}] ${p.consumer_desc}`,
      param: `${p.param_name}: ${p.param_desc}`,
      entity_type: p.entity_type,
      kind: p.kind,
    })),
    null,
    2
  )}`;

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "HTTP-Referer": "https://tatinc.us",
      "X-Title": "dep-graph-judge",
    },
    body: JSON.stringify({
      model: "anthropic/claude-sonnet-4-6",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0,
      max_tokens: 2000,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenRouter ${response.status}: ${text.slice(0, 200)}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || "";

  // Parse JSON — strip markdown fences if present
  let parsed;
  try {
    const clean = content.replace(/^```(?:json)?\s*/m, "").replace(/\s*```\s*$/m, "").trim();
    parsed = JSON.parse(clean);
    if (!Array.isArray(parsed)) throw new Error("Not an array");
  } catch (e) {
    if (attempt < 1) {
      console.warn(`  Parse failure, retrying batch... (${e.message})`);
      await new Promise((r) => setTimeout(r, 2000));
      return callLLM(batch, attempt + 1);
    }
    throw new Error(`Parse failure after retry: ${e.message}\nRaw: ${content.slice(0, 300)}`);
  }

  return parsed;
}

// ─── Judge with concurrency cap ───────────────────────────────────────────────
async function judgeAll(payloads) {
  const results = new Map();

  // Split into batches
  const batches = [];
  for (let i = 0; i < payloads.length; i += batchSize) {
    batches.push(payloads.slice(i, i + batchSize));
  }

  // Separate cached vs uncached
  const cachedBatches = [];
  const uncachedBatches = [];

  for (const batch of batches) {
    const uncached = batch.filter((p) => !cache[p.id]);
    const cached = batch.filter((p) => cache[p.id]);

    for (const p of cached) {
      results.set(p.id, cache[p.id]);
    }

    if (uncached.length > 0) uncachedBatches.push(uncached);
    if (cached.length > 0) cachedBatches.push(cached);
  }

  const totalCached = payloads.filter((p) => cache[p.id]).length;
  console.log(
    `  ${totalCached} edges from cache, ${payloads.length - totalCached} need LLM calls`
  );
  console.log(`  ${uncachedBatches.length} batches to send (concurrency cap: 5)\n`);

  if (uncachedBatches.length === 0) return results;

  // Concurrency-limited execution
  const concurrencyLimit = 5;
  let batchIndex = 0;

  async function worker() {
    while (batchIndex < uncachedBatches.length) {
      const myIndex = batchIndex++;
      const batch = uncachedBatches[myIndex];
      const batchNum = myIndex + 1;
      process.stdout.write(
        `  Batch ${batchNum}/${uncachedBatches.length} (${batch.length} edges)... `
      );

      try {
        const judgments = await callLLM(batch);

        // Map results back by id
        const judgeMap = new Map(judgments.map((j) => [j.id, j]));

        for (const p of batch) {
          const judgment = judgeMap.get(p.id);
          if (judgment) {
            const result = {
              valid: judgment.valid,
              reason: judgment.reason,
              producer_slug: p.producer_slug,
              consumer_slug: p.consumer_slug,
              param_name: p.param_name,
              entity_type: p.entity_type,
              kind: p.kind,
              confidence: p.confidence,
            };
            results.set(p.id, result);
            cache[p.id] = result;
          } else {
            // LLM missed this id — mark unknown
            const result = {
              valid: null,
              reason: "LLM response missing",
              producer_slug: p.producer_slug,
              consumer_slug: p.consumer_slug,
              param_name: p.param_name,
              entity_type: p.entity_type,
              kind: p.kind,
              confidence: p.confidence,
            };
            results.set(p.id, result);
          }
        }

        const validCount = judgments.filter((j) => j.valid).length;
        console.log(`done (${validCount}/${judgments.length} valid)`);
        saveCache();
      } catch (err) {
        console.error(`\n  ERROR on batch ${batchNum}: ${err.message}`);
        // Mark as null so they don't silently disappear
        for (const p of batch) {
          results.set(p.id, {
            valid: null,
            reason: `Judge error: ${err.message.slice(0, 50)}`,
            producer_slug: p.producer_slug,
            consumer_slug: p.consumer_slug,
            param_name: p.param_name,
            entity_type: p.entity_type,
            kind: p.kind,
            confidence: p.confidence,
          });
        }
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrencyLimit, uncachedBatches.length) }, () =>
    worker()
  );
  await Promise.all(workers);

  return results;
}

// ─── Reporting ────────────────────────────────────────────────────────────────
function pad(s, n, right = false) {
  const str = String(s);
  return right ? str.padStart(n) : str.padEnd(n);
}

function pct(n, d) {
  if (d === 0) return "  N/A";
  return ((n / d) * 100).toFixed(1).padStart(5) + "%";
}

function printTable(title, rows, headers) {
  console.log(`\n${title}`);
  console.log("─".repeat(headers.reduce((s, h) => s + h.width + 2, 0)));
  console.log(headers.map((h) => pad(h.label, h.width, h.right)).join("  "));
  console.log("─".repeat(headers.reduce((s, h) => s + h.width + 2, 0)));
  for (const row of rows) {
    console.log(row.map((cell, i) => pad(cell, headers[i].width, headers[i].right)).join("  "));
  }
  console.log("─".repeat(headers.reduce((s, h) => s + h.width + 2, 0)));
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const rng = mulberry32(seed);

  // 1. Stratified sample
  console.log("Step 1: Stratified sampling...");
  const sample = stratifiedSample(graph.edges, sampleSize, rng);
  console.log(`  Sampled ${sample.length} edges from ${graph.edges.length} total`);

  // Show type distribution in sample
  const sampleTypeCounts = {};
  sample.forEach((e) => {
    sampleTypeCounts[e.entity_type] = (sampleTypeCounts[e.entity_type] || 0) + 1;
  });
  console.log(`  Covered ${Object.keys(sampleTypeCounts).length} entity types`);

  // 2. Build payloads
  console.log("\nStep 2: Building judgment payloads...");
  const payloads = sample.map(buildPayload);

  // 3. Judge
  console.log("\nStep 3: LLM judging...");
  const judgeResults = await judgeAll(payloads);

  // 4. Compile results
  console.log("\nStep 4: Compiling results...");

  const allResults = [];
  for (const p of payloads) {
    const r = judgeResults.get(p.id);
    if (r) {
      allResults.push({
        id: p.id,
        from: p.producer_slug,
        to: p.consumer_slug,
        param: p.param_name,
        entity_type: p.entity_type,
        kind: p.kind,
        confidence: p.confidence,
        valid: r.valid,
        reason: r.reason,
      });
    }
  }

  // Filter out null (error) judgments for stats
  const judged = allResults.filter((r) => r.valid !== null);
  const valid = judged.filter((r) => r.valid === true);
  const invalid = judged.filter((r) => r.valid === false);
  const errors = allResults.filter((r) => r.valid === null);

  const overallPrecision = judged.length > 0 ? valid.length / judged.length : 0;

  // By kind
  const byKind = {};
  for (const r of judged) {
    if (!byKind[r.kind]) byKind[r.kind] = { valid: 0, total: 0 };
    byKind[r.kind].total++;
    if (r.valid) byKind[r.kind].valid++;
  }

  // By confidence bucket
  const byConf = { ">=0.9": { valid: 0, total: 0 }, "0.7-0.9": { valid: 0, total: 0 }, "<0.7": { valid: 0, total: 0 } };
  for (const r of judged) {
    const c = r.confidence || 0;
    const bucket = c >= 0.9 ? ">=0.9" : c >= 0.7 ? "0.7-0.9" : "<0.7";
    byConf[bucket].total++;
    if (r.valid) byConf[bucket].valid++;
  }

  // ─── Print summary table ───────────────────────────────────────────────────
  console.log("\n" + "═".repeat(60));
  console.log("  PRECISION EVALUATION RESULTS");
  console.log("═".repeat(60));
  console.log(`  Sample size : ${sample.length}`);
  console.log(`  Judged      : ${judged.length}`);
  console.log(`  Errors      : ${errors.length}`);
  console.log(`  Valid       : ${valid.length}`);
  console.log(`  Invalid     : ${invalid.length}`);
  console.log(`  PRECISION   : ${(overallPrecision * 100).toFixed(1)}%`);

  printTable("Precision by Edge Kind", Object.entries(byKind).map(([kind, s]) => [
    kind,
    String(s.valid),
    String(s.total),
    pct(s.valid, s.total),
  ]), [
    { label: "Kind", width: 12 },
    { label: "Valid", width: 5, right: true },
    { label: "Total", width: 5, right: true },
    { label: "Precision", width: 9, right: true },
  ]);

  printTable("Precision by Confidence Bucket", Object.entries(byConf).filter(([, s]) => s.total > 0).map(([bucket, s]) => [
    bucket,
    String(s.valid),
    String(s.total),
    pct(s.valid, s.total),
  ]), [
    { label: "Confidence", width: 10 },
    { label: "Valid", width: 5, right: true },
    { label: "Total", width: 5, right: true },
    { label: "Precision", width: 9, right: true },
  ]);

  if (invalid.length > 0) {
    console.log(`\nInvalid Edges (${invalid.length}):`);
    console.log("─".repeat(80));
    for (const r of invalid) {
      console.log(`  [${r.kind}] ${r.from} → ${r.to} (${r.param})`);
      console.log(`    entity_type: ${r.entity_type}  confidence: ${r.confidence}`);
      console.log(`    reason: ${r.reason}`);
    }
  }

  console.log("═".repeat(60));

  // ─── Write results ─────────────────────────────────────────────────────────
  const resultsPayload = {
    meta: {
      seed,
      sample_size: sample.length,
      judged: judged.length,
      errors: errors.length,
      valid: valid.length,
      invalid: invalid.length,
      precision: parseFloat((overallPrecision * 100).toFixed(1)),
      generated_at: new Date().toISOString(),
    },
    by_kind: Object.fromEntries(
      Object.entries(byKind).map(([k, s]) => [k, {
        valid: s.valid,
        total: s.total,
        precision: s.total > 0 ? parseFloat(((s.valid / s.total) * 100).toFixed(1)) : null,
      }])
    ),
    by_confidence: Object.fromEntries(
      Object.entries(byConf).map(([k, s]) => [k, {
        valid: s.valid,
        total: s.total,
        precision: s.total > 0 ? parseFloat(((s.valid / s.total) * 100).toFixed(1)) : null,
      }])
    ),
    invalid_edges: invalid.map((r) => ({
      from: r.from,
      to: r.to,
      param: r.param,
      entity_type: r.entity_type,
      kind: r.kind,
      confidence: r.confidence,
      reason: r.reason,
    })),
    all_results: allResults,
  };

  const resultsPath = join(ROOT, "data", "judge-results.json");
  writeFileSync(resultsPath, JSON.stringify(resultsPayload, null, 2));
  console.log(`\nResults written to: data/judge-results.json`);
  console.log(`Cache written to:   data/judge-cache.json`);
}

main().catch((err) => {
  console.error("\nFATAL:", err);
  process.exit(1);
});
