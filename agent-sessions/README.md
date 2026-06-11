# agent sessions

The official collector installer endpoint (api/agent-sessions/install) was returning
HTTP 500 at submission time, which makes upload.sh fail even with --skip-session
(the skip path also invokes the collector). See manifest.json.

Tooling used: Claude Code — one orchestrator session dispatching 3 parallel subagents
(graph engine / visualization / eval+docs), then an integration+polish pass that used
the eval to find and fix 2 real typing bugs. Transcripts available on request.
