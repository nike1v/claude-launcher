#!/usr/bin/env bash
# Mock ACP server (cursor / opencode flavor) — speaks just enough of
# the Agent Client Protocol to drive a single user → assistant turn
# end-to-end. Used by tests/integration/acp-flow.test.ts to exercise
# AcpAdapter + SessionManager without a real cursor / opencode
# binary on the runner.
#
# Wire format: NDJSON JSON-RPC 2.0 (the `"jsonrpc":"2.0"` field is
# required by ACP and our adapter emits it). Tracks ids by reading
# them off the client lines.

set -euo pipefail

emit() { echo "$1"; }

# Read one JSON-RPC line from the client. Sets globals
# CLIENT_ID and CLIENT_METHOD.
read_line() {
  CLIENT_ID=""
  CLIENT_METHOD=""
  if ! IFS= read -r line; then
    return 1
  fi
  CLIENT_ID=$(echo "$line" | sed -n 's/.*"id"[[:space:]]*:[[:space:]]*\([0-9]*\).*/\1/p')
  CLIENT_METHOD=$(echo "$line" | sed -n 's/.*"method"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
  return 0
}

# 1. Wait for `initialize`.
read_line || exit 0
[[ "$CLIENT_METHOD" == "initialize" ]] || exit 1
emit "{\"jsonrpc\":\"2.0\",\"id\":${CLIENT_ID},\"result\":{\"protocolVersion\":1,\"authMethods\":[{\"id\":\"cursor_login\"}],\"agentCapabilities\":{\"loadSession\":true}}}"

# 2. Wait for `authenticate`.
read_line || exit 0
[[ "$CLIENT_METHOD" == "authenticate" ]] || exit 1
emit "{\"jsonrpc\":\"2.0\",\"id\":${CLIENT_ID},\"result\":null}"

# 3. Wait for `session/new`.
read_line || exit 0
[[ "$CLIENT_METHOD" == "session/new" ]] || exit 1
SESSION_ID="sess_mock_acp_1"
emit "{\"jsonrpc\":\"2.0\",\"id\":${CLIENT_ID},\"result\":{\"sessionId\":\"${SESSION_ID}\"}}"

# 4. Cursor sets a config option for the model. Skip if not received
#    (opencode flavor wouldn't send one).
read_line || exit 0
if [[ "$CLIENT_METHOD" == "session/set_config_option" ]]; then
  emit "{\"jsonrpc\":\"2.0\",\"id\":${CLIENT_ID},\"result\":null}"
  read_line || exit 0
fi

# 5. Wait for the user's `session/prompt`.
[[ "$CLIENT_METHOD" == "session/prompt" ]] || exit 1
PROMPT_ID="$CLIENT_ID"

# 6. Stream a turn back via session/update notifications: assistant
#    text in two chunks.
emit "{\"jsonrpc\":\"2.0\",\"method\":\"session/update\",\"params\":{\"sessionId\":\"${SESSION_ID}\",\"update\":{\"sessionUpdate\":\"agent_message_chunk\",\"content\":{\"type\":\"text\",\"text\":\"Hello from \"}}}}"
emit "{\"jsonrpc\":\"2.0\",\"method\":\"session/update\",\"params\":{\"sessionId\":\"${SESSION_ID}\",\"update\":{\"sessionUpdate\":\"agent_message_chunk\",\"content\":{\"type\":\"text\",\"text\":\"mock acp.\"}}}}"

# 7. Resolve the prompt request, completing the turn.
emit "{\"jsonrpc\":\"2.0\",\"id\":${PROMPT_ID},\"result\":{\"stopReason\":\"end_of_turn\"}}"

# 8. Stay alive briefly so the test reads the trailing events before
#    stdout closes.
sleep 0.3
exit 0
