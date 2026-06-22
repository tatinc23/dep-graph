# dep-graph — project notes

Infers a typed tool-dependency graph from JSON-Schema tool catalogs, demonstrated
on Composio's `googlesuper` + `github` toolkits. See README.md for the overview
and SOLUTION.md for the full approach.

## Stack
- Node 22+ (ESM, global `fetch`, no runtime dependencies).
- Visualization: Cytoscape.js + cytoscape-fcose (vendored in `viz/vendor/`).
- Live viz hosted on Cloudflare Pages (project `composio-depgraph`).

## Commands
- `npm run eval` — validate `data/graph.json` against the ground-truth suite.
- `npm run plan <TOOL_SLUG>` — print a pre-execution plan for a tool.
- `npm run fetch` → `npm run build` → `npm run viz` — full rebuild (needs `.env`).
- `open viz/index.html` — interactive graph locally.

## Rebuild prerequisites
- `.env` with `COMPOSIO_API_KEY` and `OPENROUTER_API_KEY` (only for `fetch`/`build`).
- The committed `data/graph.json` + `viz/graph-data.js` let you run eval/plan/viz with no key.

## Data contract
`GRAPH_SPEC.md` is the source of truth for `data/graph.json` (entity types, nodes, edges).

## Deploy (live viz)
`npx wrangler pages deploy viz --project-name=composio-depgraph --branch=main`
