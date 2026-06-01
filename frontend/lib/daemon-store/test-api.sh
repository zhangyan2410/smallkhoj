#!/usr/bin/env bash
# Test script for daemon API Phase 1-2

BASE="http://localhost:3000/internal/agent-api"
TOKEN="Bearer sk_test_aaa"
AGENT="aaa"

echo "=== Test 1: No token => 401 ==="
curl -s "$BASE/server" | head -c 200
echo -e "\n"

echo "=== Test 2: server info ==="
curl -s "$BASE/server" \
  -H "Authorization: $TOKEN" \
  -H "X-Agent-Id: $AGENT" | head -c 500
echo -e "\n"

echo "=== Test 3: send message ==="
curl -s -X POST "$BASE/send" \
  -H "Authorization: $TOKEN" \
  -H "X-Agent-Id: $AGENT" \
  -H "Content-Type: application/json" \
  -d '{"target":"#all","content":"hello from test"}' | head -c 300
echo -e "\n"

echo "=== Test 4: get events ==="
curl -s "$BASE/events?since=0" \
  -H "Authorization: $TOKEN" \
  -H "X-Agent-Id: $AGENT" | head -c 500
echo -e "\n"

echo "=== Test 5: get history ==="
curl -s "$BASE/history?channel=%23all&limit=10" \
  -H "Authorization: $TOKEN" \
  -H "X-Agent-Id: $AGENT" | head -c 500
echo -e "\n"

echo "=== Test 6: claim task ==="
curl -s -X POST "$BASE/tasks/claim" \
  -H "Authorization: $TOKEN" \
  -H "X-Agent-Id: $AGENT" \
  -H "Content-Type: application/json" \
  -d '{"taskId":2}' | head -c 300
echo -e "\n"

echo "=== Test 7: update task status ==="
curl -s -X POST "$BASE/tasks/update-status" \
  -H "Authorization: $TOKEN" \
  -H "X-Agent-Id: $AGENT" \
  -H "Content-Type: application/json" \
  -d '{"taskId":2,"status":"done"}' | head -c 300
echo -e "\n"

echo "=== All tests completed ==="
