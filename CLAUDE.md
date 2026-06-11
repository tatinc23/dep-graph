# dep-graph — Composio hiring task (SUBMITTED 2026-06-11)

Tool dependency graph for Composio googlesuper + github toolkits.
Submitted via POST to eng.hiring.composio.io/api/submit (email emailme@tatinc.us, task=dep) — HTTP 200.
upload.sh was unusable: their collector installer endpoint returned 500 (even --skip-session needs it).

## Stack / commands
- Node 22 (no bun). Network scripts need unsandboxed bash (sandbox blocks node DNS).
- .env (gitignored from zip): COMPOSIO_API_KEY + OPENROUTER_API_KEY (from scaffold.sh).
- Rebuild: node scripts/fetch-tools.mjs → node scripts/build-graph.mjs → node scripts/eval.mjs → node scripts/build-viz.mjs → open viz/index.html

## Final state
- 1046 nodes, 8543 edges, 53 entity types. Eval: GT 29/29, coverage 100%, sanity 0.
- Original zip copy at "/Applications/dep-graph 3" (untouched).
