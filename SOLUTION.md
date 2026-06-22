# Tool Dependency Graph — Solution Write-Up

## Problem Restatement

Composio tools (actions) often require input parameters whose values cannot be supplied by a user directly — they are opaque internal identifiers (a Gmail thread_id, a GitHub pull_number) that only exist as outputs of prior tool executions. Before an agent can call `GOOGLESUPER_REPLY_TO_THREAD`, it must first call `GOOGLESUPER_LIST_THREADS` to obtain a valid thread_id. This project maps those upstream/downstream relationships into a typed dependency graph covering the full googlesuper and github toolkits (~1 000+ tools), so an agent runtime can automatically plan the correct pre-flight tool chain for any action.

## Approach

### 1. Entity-type extraction (structural pass)

Each tool's `input_parameters` and `output_parameters` JSON Schemas are parsed to extract:

- **Consumer params** — input properties that carry an opaque id, resolved reference, or created resource id. Heuristics flag a param as typed when its name, description, or examples contain known patterns (`*_id`, `*_number`, `*_sha`, `email`, `username`, etc.). Params with free-form human text (query strings, message bodies, subjects) are left as `entity_type: null`.
- **Producer paths** — output properties whose JSON path delivers the same kind of value. A `data.threads[].id` output on `LIST_THREADS` and a `thread_id` input on `REPLY_TO_THREAD` are unified under `gmail.thread_id`.

Entity types are namespaced (`gmail.thread_id`, `github.issue_number`, `drive.file_id`) and tagged with an **acquisition** label:
- `dependency` — opaque/internal; agent must call a producer first
- `user` — the agent can ask the user (natural-language query, body text)
- `either` — human-meaningful but resolvable (email address, username, repo name)

### 2. Producer/consumer edge construction

For each consumer param with a non-null entity type the builder searches every tool's output schema for a structurally compatible producer. Three edge **kinds** are distinguished:

| Kind | Semantics | Example |
|------|-----------|---------|
| `id_lookup` | A LIST/SEARCH/GET returns the id directly | `LIST_THREADS` → `thread_id` in REPLY_TO_THREAD |
| `resolver` | Converts human input to a required value | `SEARCH_PEOPLE` → `email` in SEND_EMAIL |
| `creator` | Creates the resource whose id is then used | `CREATE_LABEL` → `label_id` in ADD_LABEL_TO_EMAIL |

Confidence is set heuristically (0.9+ for exact name matches, 0.7 for semantic-only) and elevated to 0.95+ after an LLM verification pass using `scripts/build-graph.mjs` with the OpenRouter key.

### 3. Why this beats naive pairwise LLM matching

Pairwise LLM comparison across 1 000+ tools × 1 000+ tools = 1 000 000+ comparisons — prohibitively expensive and slow. The entity-type resolution approach reduces the search space to O(unique_types × tools_per_type): once a param is typed as `gmail.thread_id`, only the ~6 thread-related tools need to be checked as producers, not all 1 000. LLM calls are used only to verify and score a small set of structurally plausible candidates, not to discover them.

## How to Run

```bash
# 1. Build the graph (requires COMPOSIO_API_KEY and OPENROUTER_API_KEY in .env)
node scripts/build-graph.mjs

# 2. Evaluate (defaults to data/graph.json, falls back to data/graph.stub.json)
node scripts/eval.mjs
# Or against a specific file:
node scripts/eval.mjs data/graph.json
node scripts/eval.mjs data/graph.stub.json

# 3. Build the visualisation data file
node scripts/build-viz.mjs

# 4. Open the visualisation
open viz/index.html
```

## Results

```
GT: 29/29 passed | coverage: 100.0% | sanity violations: 0
```

Final graph: **1,046 nodes** (223 googlesuper + 823 github), **8,543 edges**, **53 entity types**.
100% of required dependency-class params (360/360) have at least one producer edge.
Two ground-truth failures surfaced by the eval during development (plural `add_label_ids`
missed by the typer; `file_sha` on git blobs) were fixed in the typing rules — the eval
catching real graph bugs is exactly why it exists.

Note on fan-in: `github.owner`/`github.repo` appear as inputs on ~450 GitHub tools each.
These are `either`-acquisition context params, so they connect only to a curated set of
4 canonical resolvers (repo/user search and list tools) rather than every tool that
mentions a repo — keeping the graph navigable instead of fully connected.

### Ground truth suite (29 cases)

Cases span both toolkits and all three edge kinds:

| ID | Consumer | Param | Expected producers (any) | Kind | Acq |
|----|----------|-------|--------------------------|------|-----|
| GT-01 | GOOGLESUPER_REPLY_TO_THREAD | thread_id | LIST_THREADS | id_lookup | dependency |
| GT-02 | GOOGLESUPER_REPLY_TO_THREAD | thread_id | FETCH_EMAILS | id_lookup | dependency |
| GT-03 | GOOGLESUPER_FETCH_MESSAGE_BY_THREAD_ID | thread_id | LIST_THREADS | id_lookup | dependency |
| GT-04 | GOOGLESUPER_MODIFY_THREAD_LABELS | thread_id | LIST_THREADS, FETCH_EMAILS | id_lookup | dependency |
| GT-05 | GOOGLESUPER_SEND_EMAIL | recipient_email | SEARCH_PEOPLE | resolver | either |
| GT-06 | GOOGLESUPER_SEND_EMAIL | recipient_email | GET_PEOPLE | resolver | either |
| GT-07 | GOOGLESUPER_REPLY_TO_THREAD | recipient_email | SEARCH_PEOPLE | resolver | either |
| GT-08 | GOOGLESUPER_CREATE_EMAIL_DRAFT | recipient_email | SEARCH_PEOPLE | resolver | either |
| GT-09 | GOOGLESUPER_DELETE_MESSAGE | message_id | FETCH_EMAILS | id_lookup | dependency |
| GT-10 | GOOGLESUPER_FORWARD_MESSAGE | message_id | FETCH_EMAILS | id_lookup | dependency |
| GT-11 | GOOGLESUPER_ADD_LABEL_TO_EMAIL | message_id | FETCH_EMAILS, FETCH_BY_THREAD | id_lookup | dependency |
| GT-12 | GOOGLESUPER_FETCH_MESSAGE_BY_MESSAGE_ID | message_id | FETCH_EMAILS | id_lookup | dependency |
| GT-13 | GOOGLESUPER_ADD_LABEL_TO_EMAIL | add_label_ids | CREATE_LABEL, LIST_LABELS | creator | dependency |
| GT-14 | GOOGLESUPER_DOWNLOAD_FILE | file_id | FIND_FILE | id_lookup | dependency |
| GT-15 | GOOGLESUPER_EDIT_FILE | file_id | FIND_FILE, CREATE_FILE | id_lookup/creator | dependency |
| GT-16 | GOOGLESUPER_COPY_FILE | file_id | FIND_FILE | id_lookup | dependency |
| GT-17 | GOOGLESUPER_MOVE_FILE | file_id | FIND_FILE | id_lookup | dependency |
| GT-18 | GOOGLESUPER_DELETE_EVENT | event_id | FIND_EVENT, EVENTS_LIST | id_lookup | dependency |
| GT-19 | GOOGLESUPER_UPDATE_EVENT | event_id | FIND_EVENT | id_lookup | dependency |
| GT-20 | GOOGLESUPER_GET_DRIVE | drive_id | LIST_SHARED_DRIVES, CREATE_DRIVE | id_lookup/creator | dependency |
| GT-21 | GITHUB_GET_AN_ISSUE | issue_number | ISSUES_LIST_FOR_REPO, SEARCH_ISSUES | id_lookup | dependency |
| GT-22 | GITHUB_UPDATE_AN_ISSUE | issue_number | ISSUES_LIST_FOR_REPO, SEARCH_ISSUES | id_lookup | dependency |
| GT-23 | GITHUB_CREATE_AN_ISSUE_COMMENT | issue_number | ISSUES_LIST_FOR_REPO | id_lookup | dependency |
| GT-24 | GITHUB_MERGE_A_PULL_REQUEST | pull_number | LIST_PULL_REQUESTS, FIND_PULL_REQUESTS | id_lookup | dependency |
| GT-25 | GITHUB_CREATE_A_REVIEW_COMMENT_FOR_A_PULL_REQUEST | pull_number | LIST_PULL_REQUESTS | id_lookup | dependency |
| GT-26 | GITHUB_GET_A_RELEASE | release_id | LIST_RELEASES | id_lookup | dependency |
| GT-27 | GITHUB_GET_A_GIST | gist_id | LIST_GISTS, CREATE_A_GIST | id_lookup/creator | dependency |
| GT-28 | GITHUB_UPDATE_A_GIST | gist_id | LIST_GISTS | id_lookup | dependency |
| GT-29 | GITHUB_GET_A_BLOB | file_sha | GET_A_COMMIT, LIST_COMMITS | id_lookup | dependency |

### Stub-mode baseline

Running against `data/graph.stub.json` (4 nodes, 3 edges):
- GT-01, GT-05 pass (README's canonical examples)
- GT-07 fails (stub REPLY_TO_THREAD node omits `recipient_email` param)
- All others report `[INVALID]` because only 4 of 1 000+ nodes are present — expected
- 1 sanity violation caught in the stub (a `LIST_THREADS → SEND_EMAIL:recipient_email` edge where the producer's `produces[]` array doesn't list `email_address`)

## Live demo

**https://depgraph.tatinc.us** — the interactive graph. Click "Demo" for a guided example.

## Planner CLI (what the graph is for)

`node scripts/plan.mjs GOOGLESUPER_REPLY_TO_THREAD [--depth 2] [--json]`

`scripts/plan.mjs` turns the graph into an actionable pre-execution plan for any of the 1046 tools: `user` params become "ask the user", `dependency` params get a ranked producer recommendation (preferring cheap id_lookup reads over creator calls, then confidence) with alternatives counted, and `either` params surface as "ask the user OR resolve via …". `--depth` recurses into the recommended producer's own dependencies (with cycle detection), and `--json` emits the same plan as structured data an agent can consume directly to sequence tool calls. Fuzzy slug suggestions on a miss.

## Edge precision (LLM judge)

`scripts/judge.mjs` drew a stratified, seeded 100-edge sample across all entity types and asked claude-sonnet-4.6 (OpenRouter) whether each producer genuinely yields a value usable as the consumer's param. Result: **82% precision** (id_lookup 82.7%, creator 76.5%, resolver 100%). The 18 invalid edges trace to four root causes — ID subtype conflation (10), direction errors (3), creator-returns-wrong-resource (3), cross-toolkit name collisions (2) — and manual review suggests 3-4 are judge false negatives, putting true precision at ~84-86%. Full results in data/judge-results.json; the failure taxonomy is the roadmap for the next typing iteration (subtype-aware entity types, toolkit-scoped matching).
