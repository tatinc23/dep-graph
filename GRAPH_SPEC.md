# graph.json contract (source of truth for all components)

Output file: `data/graph.json`. All components (builder, viz, eval) conform to this.

```jsonc
{
  "meta": {
    "toolkits": ["googlesuper", "github"],
    "tool_count": 0,
    "edge_count": 0,
    "generated_by": "describe pipeline briefly"
  },
  // Entity types are the semantic currency of the graph. An entity type is a
  // kind of value that flows between tools (e.g. a Gmail thread id).
  "entity_types": [
    {
      "id": "gmail.thread_id",            // namespaced, lowercase
      "name": "Gmail Thread ID",
      "description": "Opaque id of a Gmail thread",
      "acquisition": "dependency"          // "user" | "dependency" | "either"
      // user       = user can be asked directly (subject, body, query text)
      // dependency = opaque/internal id; MUST come from another tool
      // either     = human-meaningful (email address, repo name, username):
      //              the user may supply it OR a tool can resolve it
    }
  ],
  "nodes": [
    {
      "id": "GOOGLESUPER_REPLY_TO_THREAD", // tool slug
      "toolkit": "googlesuper",
      "name": "Reply To Thread",
      "description": "first sentence only",
      "params": [
        {
          "name": "thread_id",
          "required": true,
          "type": "string",
          "entity_type": "gmail.thread_id", // null if plain user input
          "acquisition": "dependency",      // resolved per-param (may differ from type default)
          "description": "short"
        }
      ],
      "produces": [
        {
          "entity_type": "gmail.thread_id",
          "json_path": "data.threads[].id"  // where in output_parameters it lives
        }
      ]
    }
  ],
  // Edge direction: from PRODUCER -> to CONSUMER ("run `from` before `to`").
  "edges": [
    {
      "from": "GOOGLESUPER_LIST_THREADS",
      "to": "GOOGLESUPER_REPLY_TO_THREAD",
      "entity_type": "gmail.thread_id",
      "param": "thread_id",                 // consumer param satisfied
      "source_path": "data.threads[].id",   // where producer emits it
      "kind": "id_lookup",                  // "id_lookup" | "resolver" | "creator"
      // id_lookup = LIST/SEARCH/GET returns the value directly
      // resolver  = converts human input to required value (name -> email via contacts)
      // creator   = creates the resource whose id is then used (create label -> label_id)
      "confidence": 0.95,                   // 0-1; heuristic=structural match, llm=verified
      "note": "optional one-liner"
    }
  ]
}
```

Hard requirements (the readme's own examples MUST hold in the final graph):
1. `GOOGLESUPER_REPLY_TO_THREAD.thread_id` ← producers incl. `GOOGLESUPER_LIST_THREADS` (and FETCH_EMAILS etc.)
2. send-email `recipient_email` is `either` + has `resolver` edges from contacts/people search tools
3. GitHub: issue ops needing `issue_number` ← list/search issues; PR ops ← list PRs; etc.

Inputs: data/googlesuper_tools.json, data/github_tools.json (regenerate with `npm run fetch`).
Build env: a `.env` with COMPOSIO_API_KEY and OPENROUTER_API_KEY (https://openrouter.ai/api/v1) is only needed to rebuild from scratch.
