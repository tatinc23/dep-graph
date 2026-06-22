# dep-graph Open-Source Cleanup — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Composio dependency-graph take-home into a clean, public-facing, open-sourced portfolio project — honest provenance, no proprietary brief, working clone-and-run, and a readable/onboarded live visualization.

**Architecture:** Static-data Node project (no build step, Node 22 built-ins only) + a single-file Cytoscape.js visualization. Cleanup is mostly deletion, doc rewrites, `package.json` correction, and a focused fix to the viz's layout + default experience.

**Tech Stack:** Node 22 (global `fetch`, ESM), Cytoscape.js + cytoscape-fcose (vendored), Cloudflare Pages (`composio-depgraph` project) for the live viz.

## Global Constraints

- License holder: **MIT, "Copyright (c) 2026 TAT Inc"**. Commit trailer: `Co-Authored-By: Claude <noreply@anthropic.com>` (no model version).
- Honest provenance **stays**: README openly credits this as a Composio take-home Ken built with Claude Code. Do NOT pretend it was his own idea.
- Do NOT paste Composio's verbatim task brief; describe the task in Ken's words, link public docs.
- Keep raw tool dumps (`data/*_tools.json`) and `data/graph.json` — clone-and-run + showcase. They are tracked, NOT gitignored.
- Add "Built on Composio → composio.dev" (README) and "Powered by Composio" (viz) promo credit.
- Scrub personal contact (`emailme@tatinc.us` etc.) and submission mechanics (`SUBMITTED`, `upload.sh` flow) from all tracked files.
- Regression guard: `node scripts/eval.mjs` must still report **GT 29/29, coverage 100%, sanity 0** after any change touching graph data or scripts.
- **HARD GATE:** Do NOT make the repo public and do NOT `git push` until Ken explicitly approves. All work stays on branch `cleanup/open-source`.
- All work is on branch `cleanup/open-source` (already created).

## File Structure

- `package.json` — rewrite: zero runtime deps, `"type": "module"`, npm scripts.
- `LICENSE` — new, MIT/TAT Inc.
- `README.md` — new (replaces `readme.md`): honest hero + background + approach + results + how-to-run + Composio credit.
- `readme.md` — delete (Composio's verbatim brief).
- `SOLUTION.md` — edit: keep technical write-up + origin; strip submission mechanics + personal email + stale demo notes.
- `GRAPH_SPEC.md` — edit: strip personal/local-path references; keep the data contract.
- `CLAUDE.md` — rewrite: clean public-safe project notes.
- `src/index.ts`, `tsconfig.json`, `scaffold.sh`, `upload.sh`, `agent-sessions/` — delete (scaffold/submission artifacts).
- `viz/vendor/cytoscape.min.js`, `viz/vendor/cytoscape-fcose.js` — new (vendored libs).
- `viz/index.html` — edit: vendored script tags, layout spacing, guided-example default, how-to card, GitHub + Composio links, title, dense-view label handling.
- `docs/screenshot.png` — new (README hero image).

---

### Task 1: Remove scaffold / dead-code artifacts

**Files:**
- Delete: `src/index.ts`, `tsconfig.json`, `scaffold.sh`, `upload.sh`, `agent-sessions/` (dir)

**Interfaces:**
- Consumes: nothing.
- Produces: a repo with no Composio-scaffold or submission artifacts. `src/` removed entirely (only held `index.ts`).

- [ ] **Step 1: Confirm nothing references these files**

Run:
```bash
cd /Users/cawc/Github/dep-graph
grep -rnE "src/index|scaffold\.sh|upload\.sh|agent-sessions|tsconfig" scripts/ viz/ data/ 2>/dev/null || echo "no references"
```
Expected: `no references` (these are standalone artifacts).

- [ ] **Step 2: Delete the files**

```bash
git rm -r src/index.ts tsconfig.json scaffold.sh upload.sh agent-sessions
rmdir src 2>/dev/null || true
```

- [ ] **Step 3: Verify the eval still passes (regression guard)**

Run: `node scripts/eval.mjs`
Expected: `GT: 29/29 passed | coverage: 100.0% | sanity violations: 0`

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: remove Composio scaffold + submission artifacts

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: Rewrite `package.json`

**Files:**
- Modify: `package.json` (full replace)

**Interfaces:**
- Consumes: nothing.
- Produces: npm scripts `fetch`, `build`, `eval`, `viz`, `plan` that run the existing `.mjs` scripts. Zero runtime dependencies (all scripts use Node 22 built-ins + global `fetch`).

- [ ] **Step 1: Replace `package.json` with:**

```json
{
  "name": "composio-dep-graph",
  "version": "1.0.0",
  "description": "Infers a typed tool-dependency graph from JSON-Schema tool catalogs, demonstrated on Composio's Google + GitHub toolkits.",
  "type": "module",
  "license": "MIT",
  "engines": { "node": ">=22" },
  "scripts": {
    "fetch": "node scripts/fetch-tools.mjs",
    "build": "node scripts/build-graph.mjs",
    "eval": "node scripts/eval.mjs",
    "viz": "node scripts/build-viz.mjs",
    "plan": "node scripts/plan.mjs"
  }
}
```

- [ ] **Step 2: Verify scripts resolve and the eval script runs via npm**

Run: `npm run eval`
Expected: `GT: 29/29 passed | coverage: 100.0% | sanity violations: 0`

- [ ] **Step 3: Verify the viz builder runs via npm (regenerates `viz/graph-data.js`)**

Run: `npm run viz && git diff --stat viz/graph-data.js`
Expected: command succeeds; `graph-data.js` either unchanged or regenerated identically (no error).

- [ ] **Step 4: Commit**

```bash
git add package.json viz/graph-data.js
git commit -m "chore: rewrite package.json — zero deps, npm scripts, type=module

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: Add MIT LICENSE

**Files:**
- Create: `LICENSE`

**Interfaces:**
- Consumes: nothing. Produces: a standard MIT license file referenced by `package.json` and README.

- [ ] **Step 1: Create `LICENSE` with the standard MIT text:**

```
MIT License

Copyright (c) 2026 TAT Inc

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 2: Commit**

```bash
git add LICENSE
git commit -m "docs: add MIT license (TAT Inc)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: New `README.md`, delete Composio's brief

**Files:**
- Delete: `readme.md`
- Create: `README.md`

**Interfaces:**
- Consumes: results figures from `SOLUTION.md` (1,046 nodes / 8,543 edges / 53 entity types / eval 29/29 / ~82% judge precision). The `docs/screenshot.png` reference is added in Task 11.
- Produces: the public front door. Honest background, no verbatim brief.

- [ ] **Step 1: Delete the old brief**

```bash
git rm readme.md
```

- [ ] **Step 2: Create `README.md`:**

```markdown
# Composio Tool Dependency Graph

A typed **dependency graph** over Composio's Google + GitHub toolkits, so an
agent runtime can automatically plan the correct pre-flight tool chain before
calling any action.

> **Live demo:** https://depgraph.tatinc.us

![Dependency graph visualization](docs/screenshot.png)

## The problem

Many tool calls need an opaque input that a user can't just type — a Gmail
`thread_id`, a GitHub `pull_number`, a Drive `file_id`. Those values only exist
as **outputs of other tools**. Before an agent can call
`GOOGLESUPER_REPLY_TO_THREAD`, it must first call something like
`GOOGLESUPER_LIST_THREADS` to obtain a valid `thread_id`.

This project parses every tool's input/output JSON Schemas across ~1,000 tools
and maps those producer → consumer relationships into a navigable graph, plus a
planner that turns any tool into an actionable "run these first" plan.

## Background

This started as a take-home exercise Composio sent me. I built the solution
(with Claude Code) and have open-sourced it as a portfolio piece — and because
it's a genuinely useful way to look at a tool catalog. Full technical write-up
in [SOLUTION.md](SOLUTION.md).

## Approach (short version)

Naive pairwise LLM matching across 1,000+ × 1,000+ tools is a million
comparisons — too slow and too expensive. Instead this types each parameter
into a namespaced **entity type** (`gmail.thread_id`, `github.issue_number`, …)
from its schema, then only matches producers and consumers that share a type —
reducing the search to `O(unique_types × tools_per_type)`. A small LLM pass
verifies and scores the structurally-plausible candidates rather than
discovering them. See [SOLUTION.md](SOLUTION.md) for entity-type resolution,
edge kinds (`id_lookup` / `resolver` / `creator`), and the failure taxonomy.

## Results

- **1,046 nodes** (223 googlesuper + 823 github), **8,543 edges**, **53 entity types**
- Ground-truth eval: **29/29**, dependency-param coverage **100%**
- LLM-judge edge precision: **~82%** on a stratified 100-edge sample

## Run it

Requires **Node 22+**. The graph and visualization data are committed, so you
can explore immediately:

```bash
npm run eval     # validate the committed graph against the ground-truth suite
npm run plan GOOGLESUPER_REPLY_TO_THREAD   # see a pre-flight plan for any tool
open viz/index.html                        # the interactive graph (or use the live demo)
```

To rebuild from scratch you need a free [Composio](https://composio.dev) API
key and an OpenRouter key in a `.env` file (`COMPOSIO_API_KEY=…`,
`OPENROUTER_API_KEY=…`):

```bash
npm run fetch    # pull current googlesuper + github tool catalogs
npm run build    # build data/graph.json
npm run viz      # regenerate viz/graph-data.js
```

## Repo map

| Path | What |
|------|------|
| `scripts/fetch-tools.mjs` | Pull raw tool catalogs from the Composio API |
| `scripts/build-graph.mjs` | Entity-type typing + producer/consumer edge construction (+ optional LLM verify) |
| `scripts/eval.mjs` | Ground-truth + coverage + sanity eval |
| `scripts/judge.mjs` | LLM-judge edge-precision sampler |
| `scripts/plan.mjs` | Turn the graph into a pre-execution plan for any tool |
| `viz/index.html` | Interactive Cytoscape.js visualization |
| `data/graph.json` | The output graph (see `GRAPH_SPEC.md` for the contract) |
| `SOLUTION.md` | Full approach write-up + eval + precision analysis |

## Built on Composio

This maps the **[Composio](https://composio.dev)** tool ecosystem — explore
their [Google Super](https://docs.composio.dev/toolkits/googlesuper) and
[GitHub](https://docs.composio.dev/toolkits/github) toolkits.

## License

MIT © 2026 TAT Inc — see [LICENSE](LICENSE).
```

- [ ] **Step 3: Verify no broken internal links and no verbatim-brief leftovers**

Run:
```bash
grep -nE "60-120 mins|use \`sh upload\.sh\`|get started" README.md || echo "clean of brief text"
ls SOLUTION.md LICENSE GRAPH_SPEC.md
```
Expected: `clean of brief text`; all three files listed.

- [ ] **Step 4: Commit**

```bash
git add README.md
git rm --cached readme.md 2>/dev/null; git add -A
git commit -m "docs: replace Composio brief with original README (honest provenance + promo)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 5: Scrub `SOLUTION.md` and `GRAPH_SPEC.md`

**Files:**
- Modify: `SOLUTION.md`, `GRAPH_SPEC.md`

**Interfaces:**
- Consumes: nothing. Produces: public-safe docs — technical content + honest origin kept; submission mechanics, personal email, and local absolute paths removed.

- [ ] **Step 1: In `SOLUTION.md`, remove submission/contact specifics**

Find and edit the "Live demo" section (around lines 117-119) to drop the "DNS propagating" / submission framing — keep only:
```markdown
## Live demo

**https://depgraph.tatinc.us** — the interactive graph. Click "Demo" for a guided example.
```
Then scan the whole file:
```bash
grep -nE "emailme@tatinc|SUBMITTED|upload\.sh|eng\.hiring\.composio|--skip-session" SOLUTION.md
```
Remove/rephrase any line that surfaces. (Stating it began as a Composio exercise is fine; submission mechanics and personal email are not.)

- [ ] **Step 2: In `GRAPH_SPEC.md`, remove the local-path / env footer**

Replace the trailing lines (around 75-77) that read:
```
Working dir: /Users/cawc/Github/dep-graph. Inputs: data/googlesuper_tools.json, data/github_tools.json.
Env: .env has COMPOSIO_API_KEY and OPENROUTER_API_KEY (https://openrouter.ai/api/v1).
Gotcha: sandboxed node has no DNS — network scripts need sandbox disabled.
```
with:
```
Inputs: data/googlesuper_tools.json, data/github_tools.json (regenerate with `npm run fetch`).
Build env: a `.env` with COMPOSIO_API_KEY and OPENROUTER_API_KEY (https://openrouter.ai/api/v1) is only needed to rebuild from scratch.
```

- [ ] **Step 3: Verify scrub**

Run:
```bash
grep -rniE "emailme@tatinc|/Users/cawc|SUBMITTED|skip-session" SOLUTION.md GRAPH_SPEC.md || echo "clean"
```
Expected: `clean`.

- [ ] **Step 4: Commit**

```bash
git add SOLUTION.md GRAPH_SPEC.md
git commit -m "docs: scrub personal/submission specifics from SOLUTION + GRAPH_SPEC

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 6: Rewrite `CLAUDE.md` (public-safe)

**Files:**
- Modify: `CLAUDE.md` (full replace)

**Interfaces:**
- Consumes: npm scripts from Task 2. Produces: a clean contributor/AI-facing notes file with no hiring/personal content.

- [ ] **Step 1: Replace `CLAUDE.md` with:**

```markdown
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
```

- [ ] **Step 2: Verify scrub**

Run: `grep -niE "hiring|emailme@tatinc|SUBMITTED|/Users/cawc|stopgap" CLAUDE.md || echo "clean"`
Expected: `clean`.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: replace project CLAUDE.md with public-safe notes

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 7: Vendor Cytoscape + fcose and fix layout loading

**Files:**
- Create: `viz/vendor/cytoscape.min.js`, `viz/vendor/cytoscape-fcose.js`
- Modify: `viz/index.html` (lines 8-14, the CDN `<script>` tags)

**Interfaces:**
- Consumes: nothing. Produces: a viz that loads fcose reliably (`cytoscapeFcose` defined), so `runLayout()` uses fcose instead of silently falling back to `cose`.

**Root cause (verified live):** on depgraph.tatinc.us, `typeof cytoscapeFcose === "undefined"` while `FCOSE_FAILED` is false — the unpkg `cytoscape-fcose` script didn't register its global and the `onerror` never fired, so the code used the weaker `cose` layout. Vendoring a pinned version fixes this deterministically and makes the static site CDN-independent.

- [ ] **Step 1: Download pinned vendored libraries** (needs network; run with sandbox disabled if blocked — unpkg.com is not in the sandbox allowlist)

```bash
cd /Users/cawc/Github/dep-graph
mkdir -p viz/vendor
curl -fsSL https://unpkg.com/cytoscape@3.30.2/dist/cytoscape.min.js -o viz/vendor/cytoscape.min.js
curl -fsSL https://unpkg.com/cytoscape-fcose@2.2.0/cytoscape-fcose.js -o viz/vendor/cytoscape-fcose.js
ls -la viz/vendor/
```
Expected: both files present, non-zero size (cytoscape ~400KB, fcose ~80KB).

- [ ] **Step 2: Point the script tags at the vendored files**

In `viz/index.html`, replace the three lines (8-14):
```html
<!-- Cytoscape.js from CDN -->
<script src="https://unpkg.com/cytoscape/dist/cytoscape.min.js"></script>
<!-- fcose layout — graceful fallback to cose if fails -->
<script src="https://unpkg.com/cytoscape-fcose/cytoscape-fcose.js" onerror="window.FCOSE_FAILED=true"></script>
```
with:
```html
<!-- Cytoscape.js + fcose layout (vendored, pinned — no CDN dependency) -->
<script src="vendor/cytoscape.min.js"></script>
<script src="vendor/cytoscape-fcose.js" onerror="window.FCOSE_FAILED=true"></script>
```

- [ ] **Step 3: Verify fcose registers (local check via Chrome DevTools)**

Open `viz/index.html` in the Chrome DevTools MCP browser, then evaluate:
```js
() => ({ fcoseFailed: !!window.FCOSE_FAILED, fcoseDefined: typeof cytoscapeFcose !== "undefined" })
```
Expected: `{ fcoseFailed: false, fcoseDefined: true }`.

- [ ] **Step 4: Commit**

```bash
git add viz/vendor viz/index.html
git commit -m "fix(viz): vendor cytoscape + fcose so the spacing layout actually loads

cytoscapeFcose was undefined on the live site (silent fallback to cose);
pinned + self-hosted so it can't fail to a worse layout.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 8: Tune layout spacing + dense-view labels

**Files:**
- Modify: `viz/index.html` (layout opts ~642-665; node label style ~562-580)

**Interfaces:**
- Consumes: working fcose from Task 7. Produces: readable spacing — nodes don't overlap; labels stay legible (always-on in small views, hover/highlight-only in dense views).

- [ ] **Step 1: Increase spacing in the fcose layout opts**

In `viz/index.html`, in the `useFcose` branch (around lines 643-656), change these values:
```js
        nodeRepulsion: 4500,
        idealEdgeLength: 80,
        edgeElasticity: 0.45,
        gravity: 0.25,
        nodeSeparation: 75,
```
to:
```js
        nodeRepulsion: 14000,
        idealEdgeLength: 150,
        edgeElasticity: 0.45,
        gravity: 0.15,
        gravityRange: 4.0,
        nodeSeparation: 160,
        padding: 60,
```
And in the `cose` fallback branch (around 657-665) change `nodeRepulsion: 4500,` → `nodeRepulsion: 12000,` and `idealEdgeLength: 80,` → `idealEdgeLength: 150,`.

- [ ] **Step 2: Add dense-view label hiding**

In the `node` style block (around 562-580), after the `"label": "data(label)",` line, the labels are always shown. Add a style rule so labels hide when a `hide-labels` class is on the node. Immediately after the `selector: "node"` style object's closing `},` (after line 580), add a new style object:
```js
    {
      selector: "node.hide-label",
      style: { "text-opacity": 0 }
    },
```
Then in `loadSubset()` (around 674-681), after `cy.add(els);` and before `runLayout();`, add:
```js
  // In dense views, hide labels by default (shown on hover/highlight) so they don't collide.
  const dense = nodeIds.length > 35;
  cy.batch(() => {
    cy.nodes().forEach(n => { dense ? n.addClass("hide-label") : n.removeClass("hide-label"); });
  });
```
Then in the node `mouseover` handler (around 990) add `evt.target.removeClass("hide-label");` and in `mouseout` (around 1002) re-apply if dense:
```js
cy.on("mouseout", "node", evt => {
  tooltip.style.display = "none";
  if (cy.nodes().length > 35 && !evt.target.hasClass("highlighted")) evt.target.addClass("hide-label");
});
```
Also in the node `tap` handler (around 936-947), after `hood.removeClass("faded").addClass("highlighted");` add `hood.removeClass("hide-label");` so a clicked node's neighborhood always shows labels.

- [ ] **Step 3: Visual verification (Chrome DevTools MCP)**

Open `viz/index.html`, click **Show All**, screenshot. Expected: nodes spread out, no large overlapping blobs; in the dense overview labels appear only on hover/clicked neighborhoods. Then reload (default guided view from Task 9 not yet present — for now verify Demo): click **▶ Demo**, screenshot. Expected: ~4-8 nodes clearly spaced with readable labels.

- [ ] **Step 4: Commit**

```bash
git add viz/index.html
git commit -m "fix(viz): spread layout (higher repulsion/edge length) + hover labels in dense views

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 9: Default to the guided example + how-to card

**Files:**
- Modify: `viz/index.html` (Demo handler ~779-817; initial load ~1005; add card HTML/CSS/JS)

**Interfaces:**
- Consumes: layout from Tasks 7-8. Produces: cold-open lands on the readable flagship neighborhood with the side panel open, plus a dismissible "How to use" card (localStorage-gated).

- [ ] **Step 1: Extract the Demo logic into a reusable function**

In `viz/index.html`, the Demo click handler (around 779-817) builds the flagship neighborhood. Refactor: define a function `showGuidedExample()` containing the body currently inside the `addEventListener("click", () => { ... })`, then have the listener call it:
```js
function showGuidedExample() {
  // ... (existing demo body: find flagship, clear filters, build neighborhood,
  //      loadSubset([...neighborIds], () => true), setTimeout highlight + showNodePanel)
}
document.getElementById("btn-demo").addEventListener("click", showGuidedExample);
```

- [ ] **Step 2: Make the cold-open use the guided example**

Replace the initial load line (around 1005):
```js
// ── Initial load ───────────────────────────────────────────────────────────
applyFilters("");
```
with:
```js
// ── Initial load: open into the readable guided example ──────────────────────
showGuidedExample();
maybeShowIntro();
```

- [ ] **Step 3: Add the how-to card markup**

In the `<body>`, just before the closing `</body>` (after the `#hint` element, around line 458), add:
```html
<div id="intro-card" class="hidden">
  <button id="intro-close" aria-label="Dismiss">×</button>
  <h2>How to read this graph</h2>
  <p>Each <strong>node</strong> is a tool. An arrow <strong>A → B</strong> means
     run <strong>A</strong> first to get a value that <strong>B</strong> needs
     (e.g. a thread id, a pull-request number).</p>
  <ul>
    <li><strong>Click</strong> any tool to see what must run before it.</li>
    <li><strong>Search</strong> a tool by name up top.</li>
    <li>Hit <strong>▶ Demo</strong> for a guided example.</li>
  </ul>
  <button id="intro-go">Got it</button>
</div>
```

- [ ] **Step 4: Add the how-to card styles**

In the `<style>` block, add:
```css
#intro-card {
  position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
  width: min(420px, 90vw); background: var(--surface2);
  border: 1px solid var(--border); border-radius: 12px; padding: 24px;
  z-index: 50; box-shadow: 0 16px 48px rgba(0,0,0,0.6);
}
#intro-card.hidden { display: none; }
#intro-card h2 { font-size: 16px; color: var(--accent); margin-bottom: 10px; }
#intro-card p, #intro-card li { font-size: 13px; color: var(--text); line-height: 1.5; }
#intro-card ul { margin: 10px 0 0 18px; }
#intro-card li { margin-bottom: 4px; }
#intro-close {
  position: absolute; top: 10px; right: 12px; background: none; border: none;
  color: var(--text-dim); font-size: 20px; cursor: pointer; line-height: 1;
}
#intro-go {
  margin-top: 16px; background: var(--accent); color: #fff; border: none;
  border-radius: 6px; padding: 8px 16px; font-size: 13px; cursor: pointer;
}
```

- [ ] **Step 5: Add the intro show/dismiss logic**

In the `<script>`, before the initial-load call, add:
```js
function maybeShowIntro() {
  try { if (localStorage.getItem("depgraph_seen_intro")) return; } catch (e) {}
  document.getElementById("intro-card").classList.remove("hidden");
}
function dismissIntro() {
  document.getElementById("intro-card").classList.add("hidden");
  try { localStorage.setItem("depgraph_seen_intro", "1"); } catch (e) {}
}
document.getElementById("intro-close").addEventListener("click", dismissIntro);
document.getElementById("intro-go").addEventListener("click", dismissIntro);
```

- [ ] **Step 6: Visual verification (Chrome DevTools MCP)**

In the DevTools browser, run `() => { try { localStorage.removeItem("depgraph_seen_intro"); } catch(e){} }`, reload `viz/index.html`, screenshot.
Expected: intro card visible; behind it the flagship (Reply to Thread) neighborhood spaced and readable with the side panel open. Click "Got it" → card dismisses; reload → card does NOT reappear.

- [ ] **Step 7: Commit**

```bash
git add viz/index.html
git commit -m "feat(viz): cold-open into guided example + dismissible how-to card

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 10: Viz branding — title, GitHub link, Composio credit

**Files:**
- Modify: `viz/index.html` (`<title>` line 6; topbar `<h1>` ~378; legend/footer area)

**Interfaces:**
- Consumes: nothing. Produces: a recruiter-legible header + promo credit.

- [ ] **Step 1: Update the page title** (line 6)

```html
<title>Tool Dependency Graph — agent pre-flight planner</title>
```

- [ ] **Step 2: Add GitHub + Composio links to the top bar**

After the `<h1>⬡ Dep Graph</h1>` (around line 378), and after the `#stats` element, the top bar has flexible space. Add a right-aligned link group. Insert immediately before the search wrap (or at the end of `#topbar`), a spacer + links:
```html
  <div style="flex:1"></div>
  <a id="composio-link" href="https://composio.dev" target="_blank" rel="noopener"
     style="font-size:12px;color:var(--text-dim);text-decoration:none;white-space:nowrap">
     Powered by Composio ↗</a>
  <a id="repo-link" href="https://github.com/tatinc23/dep-graph" target="_blank" rel="noopener"
     style="font-size:12px;color:var(--accent);text-decoration:none;white-space:nowrap;margin-left:12px">
     GitHub ↗</a>
```
> NOTE: confirm the final public repo URL (org `tatinc23`, repo name) with Ken before deploy; update both `href` and README if it differs.

- [ ] **Step 3: Visual verification**

Open `viz/index.html` in DevTools browser, screenshot the top bar. Expected: title mark + "Powered by Composio ↗" + "GitHub ↗" visible and not overlapping the search/filter controls at desktop width.

- [ ] **Step 4: Commit**

```bash
git add viz/index.html
git commit -m "feat(viz): page title + GitHub link + Powered by Composio credit

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 11: Mobile sanity check + README screenshot

**Files:**
- Create: `docs/screenshot.png`
- Modify: `viz/index.html` only if the mobile check reveals a clear breakage

**Interfaces:**
- Consumes: the finished viz. Produces: `docs/screenshot.png` referenced by the README (Task 4).

- [ ] **Step 1: Mobile width check (Chrome DevTools MCP)**

Resize the DevTools page to 390×844 and load `viz/index.html`. Screenshot. Expected: top bar wraps (it already uses `flex-wrap`), graph + intro card usable. If something is clearly broken (controls overflow off-screen, card wider than viewport), fix minimally in `viz/index.html` and note it; otherwise leave as-is (don't gold-plate).

- [ ] **Step 2: Capture the README hero screenshot**

Resize to 1440×900, load `viz/index.html`, dismiss the intro card (so the graph is the hero), ensure the guided example is shown and readable, and save a screenshot to `docs/screenshot.png`:
```
take_screenshot(format="png", filePath="/Users/cawc/Github/dep-graph/docs/screenshot.png")
```
Expected: a clean, readable graph image (the flagship neighborhood, spaced, labeled).

- [ ] **Step 3: Verify README references the image**

Run: `grep -n "docs/screenshot.png" README.md && ls -la docs/screenshot.png`
Expected: the `![...](docs/screenshot.png)` line from Task 4 + the file present.

- [ ] **Step 4: Commit**

```bash
git add docs/screenshot.png viz/index.html
git commit -m "docs: add README screenshot; mobile sanity pass

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 12: Final acceptance sweep

**Files:** none (verification only; small fixes if anything fails)

**Interfaces:** Consumes the whole repo. Produces: confidence that acceptance criteria 1-7 hold.

- [ ] **Step 1: Secrets + personal-info sweep over tracked files**

Run:
```bash
cd /Users/cawc/Github/dep-graph
git ls-files | xargs grep -niE "emailme@tatinc|/Users/cawc|SUBMITTED|sk-or-v1-[a-z0-9]|ak_0bHQH7" 2>/dev/null || echo "CLEAN"
```
Expected: `CLEAN`. (Composio brand mentions are intentional and allowed.)

- [ ] **Step 2: Confirm data + license + readme present and brief gone**

Run:
```bash
ls data/github_tools.json data/googlesuper_tools.json data/graph.json LICENSE README.md
test ! -f readme.md && echo "old brief removed"
```
Expected: all listed; `old brief removed`.

- [ ] **Step 3: Regression — eval + viz build**

Run: `npm run eval && npm run viz`
Expected: `GT: 29/29 passed | coverage: 100.0% | sanity violations: 0`; viz builder succeeds.

- [ ] **Step 4: Confirm `.gitignore` keeps `.env` out and dumps in**

Run:
```bash
git check-ignore .env && echo ".env ignored OK"
git ls-files data/ | grep -q "_tools.json" && echo "dumps tracked OK"
```
Expected: `.env ignored OK` and `dumps tracked OK`.

- [ ] **Step 5: Commit any fixes (if Steps 1-4 required changes)**

```bash
git add -A && git commit -m "chore: final acceptance fixes

Co-Authored-By: Claude <noreply@anthropic.com>" || echo "nothing to commit"
```

---

### Task 13: Deploy the updated viz (live demo)

**Files:** none (deploy only)

**Interfaces:** Consumes the finished `viz/` dir. Produces: updated depgraph.tatinc.us.

> Deploy is safe to do before the repo goes public — it ships only the static `viz/` site, not the repo. (Sandbox/wrangler can hit ENOSPC; run with sandbox disabled if output is lost.)

- [ ] **Step 1: Confirm the Pages project name**

Run: `npx wrangler pages project list`
Expected: a project named `composio-depgraph` (the one serving depgraph.tatinc.us). If the name differs, use the actual name in Step 2.

- [ ] **Step 2: Deploy**

Run: `npx wrangler pages deploy viz --project-name=composio-depgraph --branch=main`
Expected: a successful deploy with a `*.pages.dev` URL.

- [ ] **Step 3: Verify live**

Navigate (Chrome DevTools MCP) to https://depgraph.tatinc.us, then evaluate:
```js
() => ({ fcoseDefined: typeof cytoscapeFcose !== "undefined", title: document.title })
```
Expected: `fcoseDefined: true`, title updated. Screenshot to confirm the guided-example cold-open + how-to card + spacing all render on the live site.

---

## Manual gate (Ken — NOT automated)

These are Ken's calls, done after the plan executes and he reviews the branch:

1. **Rotate the live keys** in `.env` (Composio + OpenRouter) as hygiene — the task is done.
2. **Confirm the public repo name/URL** (org `tatinc23`) so the viz GitHub link + README are correct.
3. **Approve going public + push:** merge `cleanup/open-source` → `main`, push, then flip the GitHub repo to public. (Per the hard gate, the implementer does NONE of this without explicit approval.)

---

## Self-Review

**Spec coverage:**
- §1 Provenance reframe → Tasks 4 (README background), 5 (SOLUTION scrub). ✓
- §2 Data keep + promo → kept (no deletion task); promo in Tasks 4, 10. ✓
- §3 Dead-code/scaffold + package.json → Tasks 1, 2. ✓
- §4 License + CLAUDE.md → Tasks 3, 6. ✓
- §5 UI polish (title/links/mobile/screenshot/redeploy) → Tasks 10, 11, 13. ✓
- §6 README → Task 4. ✓
- §7 Graph readability + onboarding → Tasks 7, 8, 9. ✓
- Secrets/acceptance → Task 12. Manual gate (keys, public flip) → Manual gate section. ✓

**Placeholder scan:** No "TBD"/"handle edge cases"; all code shown inline. The one explicit human confirmation (repo URL) is flagged as a NOTE in Task 10 Step 2, not a code placeholder. ✓

**Type/name consistency:** `showGuidedExample()` defined in Task 9 Step 1, called in Task 9 Step 2; `maybeShowIntro()`/`dismissIntro()` defined and wired in Task 9 Steps 5/2; `hide-label` class added in Task 8 Step 2 and referenced consistently; `composio-depgraph` project name consistent across CLAUDE.md (Task 6), README is key-agnostic, and Task 13. ✓
