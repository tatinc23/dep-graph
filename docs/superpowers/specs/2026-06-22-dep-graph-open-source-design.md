# dep-graph — Open-Source Cleanup Design

**Date:** 2026-06-22
**Goal:** Clean up the tool-dependency-graph project into a public-facing, open-sourced portfolio piece for an AI-engineering job hunt. Time-sensitive (resume going out ASAP).
**Owner:** TAT Inc (Ken Adams)

## Context

The repo is Ken's solution to a Composio take-home hiring exercise (submitted 2026-06-11). It builds a typed dependency graph over the full `googlesuper` + `github` Composio toolkits (1,046 tools, 8,543 edges, 53 entity types), with an eval suite (29/29 ground truth), an LLM-judge precision pass (~82%), a planner CLI, and an interactive Cytoscape.js visualization deployed at depgraph.tatinc.us / composio-depgraph.pages.dev.

The work itself is strong portfolio material. Approach: publish with **honest credit** to Composio as the origin (it was their take-home; Ken built it with Claude Code) and frame it as a **showcase/promo** for their toolkits. The one piece we still avoid republishing is Composio's **verbatim task brief** (`readme.md` — their copyrighted text); we describe the task in Ken's words and link their public docs instead. The raw tool catalog stays (fetchable by anyone with a free key, schemas only, no secrets) for clone-and-run reproducibility and fuller showcase.

## Decisions (locked during brainstorming)

| Decision | Choice |
|----------|--------|
| Go-public plan | Honest provenance (credit Composio as origin) + showcase/promo their toolkits |
| Repo visibility | Public (after cleanup; do NOT flip public or push until Ken approves) |
| License | MIT, "Copyright (c) 2026 TAT Inc" |
| Keep `data/graph.json` + `viz/graph-data.js`? | **Yes** — Ken's derived artifact; makes the static demo work with zero build |
| Keep raw tool dumps? | **Yes** — clone-and-run reproducibility + fuller showcase. Data is fetchable by anyone with a free key; contains schemas only, no secrets |
| Showcase/promo Composio? | **Yes** — "Built on Composio — explore their toolkits →" credit in README + viz, linking composio.dev |
| Email Composio first? | **No** — Ken's call; honest credit + promo framing instead |
| CLAUDE.md | Scrub to a clean, public-safe version (no hiring/personal refs) |
| Secrets | Audit complete — clean (see below); rotate live keys as hygiene |

## Secrets Audit (complete — CLEAN)

- `.env` (Composio + OpenRouter live keys) was **never tracked** by git.
- No key **values** appear anywhere in git history or in any tracked file.
- All scripts read keys from `.env` via `process.env` — nothing hardcoded.
- **Recommendation:** revoke/rotate the two live keys as hygiene since the task is done. Not a blocker — they are not leaked via git.

## Scope of Work

### 1. Provenance — honest origin credit
Be upfront that the task originated as a Composio take-home that Ken built (with Claude Code). Do **not** pretend it was his own idea. Honesty applies to *crediting the origin of the prompt*; it does **not** require republishing Composio's proprietary text or data.

- README includes a short, plainly-worded **"Background"** note: this started as a take-home exercise Composio sent me; I built the solution and open-sourced it as a portfolio piece / because it's a genuinely useful tool. Credit that it was built AI-assisted with Claude Code (honest, and on-brand for an AI-engineering resume).
- Delete `readme.md` (Composio's verbatim brief — their copyrighted text). Replace with new `README.md`: describe the task in Ken's own words and **link Composio's public docs**, rather than pasting their brief.
- Edit `SOLUTION.md`: keep the origin context and the technical write-up (entity-type resolution, eval, judge precision, fan-in handling, failure taxonomy); strip the submission mechanics ("SUBMITTED via POST", `upload.sh` flow) and personal email/contact.
- Scrub personal contact info (`emailme@tatinc.us`, etc.) from `SOLUTION.md`, `GRAPH_SPEC.md`, scripts, and the viz. (Crediting Composio stays; personal email goes.)

### 2. Data — keep + showcase
- **Keep** `data/github_tools.json`, `data/googlesuper_tools.json`, `data/graph.json`, `viz/graph-data.js`. Rationale: clone-and-run reproducibility (no signup needed to run eval/build), fuller showcase of Composio's toolkits. Data is fetchable by anyone with a free Composio key, contains only tool schemas (no secrets — verified).
- **Promo/credit angle:** add a clear "Built on **Composio** — explore their toolkits →" credit/link (to composio.dev) in the README and a small "Powered by Composio" link in the viz.
- `scripts/fetch-tools.mjs` stays as the documented refresh path (to re-pull current toolkits if they go stale).
- Confirm dumps contain no secret values (done: only param-name matches like `token`/`api_key`).

### 3. Dead-code / scaffold removal
- Delete: `src/index.ts` (Composio example snippet; imports uninstalled `@composio/core`), `scaffold.sh`, `upload.sh`, `agent-sessions/` (submission session-tracing), `tsconfig.json` (only existed for the TS file).
- Fix `package.json`: deps don't match usage (lists `@anthropic-ai/claude-agent-sdk` + `zod`; scripts use plain Node `fetch`). Set correct/minimal deps, add `"type": "module"`, add `scripts` entries: `fetch`, `build`, `eval`, `viz`, `plan`.

### 4. License + hygiene
- Add `LICENSE` (MIT, "Copyright (c) 2026 TAT Inc").
- `.gitignore`: ensure `node_modules`, `.env`. (Raw dumps are kept/tracked — do NOT ignore them.)
- Replace `CLAUDE.md` with a clean public-safe version: stack, build commands, architecture, gotchas — no hiring/personal content.

### 5. UI polish (light — UI is already solid)
- Reframe `<title>` and keep the `⬡` mark; title → e.g. "Tool Dependency Graph — agent pre-flight planner".
- Add a small top-right **GitHub repo link** and a one-line "what is this" so a cold visitor understands it in ~5 seconds.
- Add a subtle **"Powered by Composio"** link (→ composio.dev) — the promo/showcase credit.
- Mobile/responsive sanity check.
- Capture a clean **screenshot** (PNG) for the README; optionally a short GIF of the Demo interaction.
- Redeploy viz to `depgraph.tatinc.us` after changes.

### 6. README
Structure: hero line + screenshot → **Background** (honest: started as a Composio take-home I built with Claude Code, open-sourced as a portfolio piece / useful tool) → problem (Ken's words) → approach (entity-type resolution + the O(unique_types × tools) insight vs. naive pairwise) → results (1,046 nodes / 8,543 edges / eval 29/29 / ~82% judge precision) → live demo link → how to run → **Built on Composio** credit (→ composio.dev) → architecture/repo map. Link to `SOLUTION.md` for depth.

## Non-Goals (YAGNI)
- No re-architecture of the graph builder, eval, or viz internals.
- No new features (no new toolkits, no new edge kinds).
- No unrelated refactoring of working scripts.
- Not emailing Composio first (Ken's decision — honest credit + promo framing instead).

## Acceptance Criteria
1. No personal contact info (`emailme@tatinc.us`, etc.) or submission mechanics (`SUBMITTED`, `upload.sh` flow) in tracked files. Composio credit/origin **stays** (intentional).
2. Raw dumps (`data/*_tools.json`) **kept** and tracked; verified secret-free.
3. `node scripts/eval.mjs` still passes 29/29 against committed `graph.json`.
4. `node scripts/build-viz.mjs` regenerates `viz/graph-data.js` from `graph.json`.
5. New `README.md` (honest Background + "Built on Composio" credit) + `LICENSE` (MIT/TAT Inc) present; no Composio brief verbatim.
6. Live viz redeployed, loads, shows GitHub link + "Powered by Composio" link, demo works.
7. Repo NOT made public and NOT pushed until Ken explicitly approves.
