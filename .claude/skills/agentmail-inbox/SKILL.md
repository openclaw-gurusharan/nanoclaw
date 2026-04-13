---
name: agentmail-inbox
description: |
  Read and send email from andy-developer@agentmail.to via the AgentMail API.
  Load this skill when any agent needs to read its inbox, retrieve a specific message,
  poll for an OTP code (X/Twitter, Upwork, YouTube, or any other service), or send
  a reply. Auth is handled via AGENTMAIL_API_KEY (OneCLI placeholder pattern — real
  key injected by OneCLI proxy at HTTPS intercept time).
---

# AgentMail Inbox

`andy-developer@agentmail.to` is the agent inbox for OTP flows and service-auth emails.
All reads and sends go through the AgentMail REST API.

## Credentials

| Var | Pattern | Notes |
|-----|---------|-------|
| `AGENTMAIL_API_KEY` | OneCLI placeholder | Never stored raw — proxy injects real key |

If `AGENTMAIL_API_KEY` is unset or `placeholder`, the OneCLI proxy will substitute the
real value. Do **not** hardcode or log the key.

## API Base URL

```
https://api.agentmail.to/v0
```

All requests require `Authorization: Bearer $AGENTMAIL_API_KEY`.

## Rate Limits

| Endpoint | Limit |
|----------|-------|
| List threads | 60 req/min |
| Read message | 120 req/min |
| Send message | 30 req/min |
| Poll (OTP loop) | 1 req/5 s (max 60 attempts = 5 min) |

## Operations

### List Threads

Returns the most recent email threads in the inbox.

```bash
curl -s -H "Authorization: Bearer $AGENTMAIL_API_KEY" \
  "https://api.agentmail.to/v0/inboxes/andy-developer@agentmail.to/threads?limit=20" \
  | jq '.[].{id,subject,from,receivedAt}'
```

Response fields: `id`, `subject`, `from`, `snippet`, `receivedAt`, `messageCount`.

### Read Message by ID

```bash
THREAD_ID="<thread-id>"
curl -s -H "Authorization: Bearer $AGENTMAIL_API_KEY" \
  "https://api.agentmail.to/v0/inboxes/andy-developer@agentmail.to/threads/$THREAD_ID/messages" \
  | jq '.[0].body'
```

### Poll for OTP (Regex Match)

Use when waiting for a one-time code from X/Twitter, Upwork, YouTube, or similar services.

**Algorithm:**

1. Record `start_time` and set `timeout = 300s`, `interval = 5s`.
2. Loop: GET latest threads, filter by sender domain or subject keyword.
3. For each matching thread, read the latest message body.
4. Apply regex to extract the OTP code (e.g. `\b[0-9]{6}\b` for 6-digit codes).
5. If found → return code. If elapsed > timeout → fail with "OTP not received".

```bash
# Example: poll for 6-digit OTP from twitter.com
PATTERN="[0-9]{6}"
SENDER_FILTER="twitter.com"
TIMEOUT=300
INTERVAL=5
START=$(date +%s)

while true; do
  NOW=$(date +%s)
  if (( NOW - START > TIMEOUT )); then echo "TIMEOUT"; exit 1; fi

  BODY=$(curl -s -H "Authorization: Bearer $AGENTMAIL_API_KEY" \
    "https://api.agentmail.to/v0/inboxes/andy-developer@agentmail.to/threads?limit=10" \
    | jq -r '.[].id' \
    | while read tid; do
        curl -s -H "Authorization: Bearer $AGENTMAIL_API_KEY" \
          "https://api.agentmail.to/v0/inboxes/andy-developer@agentmail.to/threads/$tid/messages" \
          | jq -r '.[0] | select(.from | test("'$SENDER_FILTER'")) | .body'
      done)

  OTP=$(echo "$BODY" | grep -oE "$PATTERN" | head -1)
  if [ -n "$OTP" ]; then echo "$OTP"; exit 0; fi

  sleep "$INTERVAL"
done
```

### Send Message

```bash
curl -s -X POST \
  -H "Authorization: Bearer $AGENTMAIL_API_KEY" \
  -H "Content-Type: application/json" \
  "https://api.agentmail.to/v0/inboxes/andy-developer@agentmail.to/messages" \
  -d '{
    "to": "recipient@example.com",
    "subject": "Subject line",
    "body": "Plain-text message body."
  }'
```

Response: `{ "id": "<message-id>", "status": "sent" }`

### Reply to Thread

```bash
THREAD_ID="<thread-id>"
curl -s -X POST \
  -H "Authorization: Bearer $AGENTMAIL_API_KEY" \
  -H "Content-Type: application/json" \
  "https://api.agentmail.to/v0/inboxes/andy-developer@agentmail.to/threads/$THREAD_ID/reply" \
  -d '{"body": "Reply text here."}'
```

## OTP Service Patterns

| Service | Sender Domain | Subject Pattern | Code Regex |
|---------|--------------|-----------------|------------|
| X / Twitter | `twitter.com` | "confirmation code" | `\b[0-9]{6}\b` |
| Upwork | `upwork.com` | "verification" | `\b[0-9]{6}\b` |
| YouTube / Google | `accounts.google.com` | "security code" | `[0-9]{6}` |
| Generic | _(any)_ | _(any)_ | `\b[0-9]{4,8}\b` |

## Pre-flight Check

```bash
[ -z "$AGENTMAIL_API_KEY" ] && echo "WARN: AGENTMAIL_API_KEY unset (OneCLI will inject)" || echo "OK"
```

If the var is `placeholder`, OneCLI proxy substitution is active — this is expected.
