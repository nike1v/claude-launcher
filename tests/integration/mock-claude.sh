#!/usr/bin/env bash
# Mock claude script — outputs pre-recorded stream-json events then exits.
sleep 0.1
echo '{"type":"system","subtype":"init","session_id":"mock-sess-1","model":"claude-sonnet-4-5","cwd":"/tmp","tools":[],"mcp_servers":[]}'
read -t 5 user_input  # wait for a user message on stdin
echo '{"type":"assistant","message":{"id":"msg-1","type":"message","role":"assistant","content":[{"type":"text","text":"Hello from mock!"}],"model":"claude-sonnet-4-5","stop_reason":"end_turn","usage":{"input_tokens":10,"output_tokens":5}}}'
echo '{"type":"result","subtype":"success","session_id":"mock-sess-1","cost_usd":0.001,"duration_ms":100,"is_error":false,"num_turns":1}'
exit 0
