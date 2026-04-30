#!/usr/bin/env bash
# Mock `codex app-server` — speaks just enough of the JSON-RPC protocol
# to drive a single user → assistant turn end-to-end. Used by
# tests/integration/codex-flow.test.ts so we can exercise the whole
# CodexAdapter + SessionManager pipeline without needing a real codex
# binary on the test runner.
#
# Wire format (per upstream README): NDJSON JSON-RPC, no `jsonrpc`
# field, both directions. Server emits requests + notifications;
# client emits requests too. We track ids by reading them off the
# client lines so our responses correlate.

set -euo pipefail

emit() { echo "$1"; }

# Read one JSON-RPC line from the client. Returns id (or empty) and
# method (or empty) by mutating globals.
read_line() {
  CLIENT_ID=""
  CLIENT_METHOD=""
  if ! IFS= read -r line; then
    return 1
  fi
  # Cheap JSON id / method extraction — good enough for synthetic
  # well-formed test payloads. Avoids depending on jq on the runner.
  CLIENT_ID=$(echo "$line" | sed -n 's/.*"id"[[:space:]]*:[[:space:]]*\([0-9]*\).*/\1/p')
  CLIENT_METHOD=$(echo "$line" | sed -n 's/.*"method"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
  return 0
}

# 1. Wait for `initialize`.
read_line || exit 0
[[ "$CLIENT_METHOD" == "initialize" ]] || exit 1
emit "{\"id\":${CLIENT_ID},\"result\":{\"userAgent\":\"codex-mock/0.0.0\",\"codexHome\":\"/tmp/codex-home\"}}"

# 2. Expect `initialized` notification.
read_line || exit 0
[[ "$CLIENT_METHOD" == "initialized" ]] || exit 1

# 3. Expect `thread/start`.
read_line || exit 0
[[ "$CLIENT_METHOD" == "thread/start" ]] || exit 1
emit "{\"id\":${CLIENT_ID},\"result\":{\"thread\":{\"id\":\"thr_mock_1\",\"model\":\"gpt-5-codex\",\"cwd\":\"/tmp\"}}}"

# 4. Followed by the `thread/started` notification — the adapter uses
#    this as the session-ready signal.
emit '{"method":"thread/started","params":{"thread":{"id":"thr_mock_1","model":"gpt-5-codex","cwd":"/tmp"}}}'

# 5. Wait for the user's `turn/start`.
read_line || exit 0
[[ "$CLIENT_METHOD" == "turn/start" ]] || exit 1
TURN_ID="tn_mock_1"
emit "{\"id\":${CLIENT_ID},\"result\":{\"turn\":{\"id\":\"${TURN_ID}\"}}}"

# 6. Stream a turn back: turn/started → item.started (agentMessage)
#    → two deltas → item.completed → turn/completed.
emit "{\"method\":\"turn/started\",\"params\":{\"turn\":{\"id\":\"${TURN_ID}\"}}}"
emit "{\"method\":\"item/started\",\"params\":{\"turnId\":\"${TURN_ID}\",\"item\":{\"id\":\"i_mock_1\",\"type\":\"agentMessage\"}}}"
emit "{\"method\":\"item/agentMessage/delta\",\"params\":{\"itemId\":\"i_mock_1\",\"delta\":\"Hello from \"}}"
emit "{\"method\":\"item/agentMessage/delta\",\"params\":{\"itemId\":\"i_mock_1\",\"delta\":\"mock codex.\"}}"
emit "{\"method\":\"item/completed\",\"params\":{\"item\":{\"id\":\"i_mock_1\",\"type\":\"agentMessage\"}}}"
emit "{\"method\":\"turn/completed\",\"params\":{\"turn\":{\"id\":\"${TURN_ID}\"}}}"

# 7. Stay alive briefly so the test reads the trailing events before
#    the process closes its stdout (which would race the line buffer).
sleep 0.3
exit 0
