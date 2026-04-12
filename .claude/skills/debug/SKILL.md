---
name: debug
description: |
  Debug container agent issues. Use when things aren't working, container fails,
  authentication problems, service start/stop, or worker flow issues.
  Covers Apple Container, networking, service management, and Jarvis worker debug.
---

# NanoClaw Debug

Use this skill for runtime/auth/container/session/worker failures.

## Rules

1. Use script-first diagnostics via `bash scripts/jarvis-ops.sh <command>`.
2. Treat Apple `container` CLI as the default runtime interface.
3. Keep evidence-based outputs (status/trace/bundle), not ad-hoc guesses.

## Quick Diagnostics

```bash
bash scripts/jarvis-ops.sh preflight
bash scripts/jarvis-ops.sh status
bash scripts/jarvis-ops.sh reliability
```

If any command fails, capture exact output and continue via issue category below.

---

## Container Runtime

### Issue Categories

| Symptom | Path |
|---------|------|
| Runtime not responding, CLI hangs | Runtime health + recovery |
| WhatsApp conflict/connectionReplaced | Runtime ownership + session isolation |
| Worker dispatch/probe failures | Connectivity + trace |
| Auth/session failures | Auth + session |
| Mount/permission/config failures | Mount + config |
| MCP failures | MCP reliability loop |

### Runtime Health + Recovery

```bash
container system status
container builder status
container ls -a
```

If unhealthy:

```bash
bash scripts/jarvis-ops.sh recover
bash scripts/jarvis-ops.sh preflight
bash scripts/jarvis-ops.sh status
```

### Duplicate Container Recovery

```bash
/bin/zsh -lc "launchctl kickstart -k gui/$(id -u)/com.apple.container.apiserver && launchctl kickstart -k gui/$(id -u)/com.apple.container.container-runtime-linux.buildkit"
container system start
launchctl kickstart -k gui/$(id -u)/com.nanoclaw
container ls -a | rg 'nanoclaw-andy-developer|nanoclaw-jarvis'
```

### Build Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `Dialing builder` hangs | Builder stuck | Restart launchd services directly, then `container builder start` |
| `structure needs cleaning` | Buildkit storage corruption | `container stop buildkit && container rm buildkit && container builder start` then rebuild |
| `.dockerignore: no such file` | Degraded builder | Same as corruption fix above |
| `EAI_AGAIN` in buildkit DNS | Network resolution fail | Use `container/worker/build.sh` artifact flow with local vendor tarballs |

### Apple Container Networking

Apple Container uses a separate bridge network (`192.168.64.0/24`). The host is always at `192.168.64.1` (`bridge100`). **`host.docker.internal` does NOT resolve — it has no built-in DNS entry.**

#### Diagnostic: test host reachability from inside container

```bash
container run --rm --entrypoint sh nanoclaw-agent:latest -c '
  curl -s --max-time 5 http://192.168.64.1:7802/health && echo "7802 ok" || echo "7802 FAIL"
  curl -s --max-time 5 http://192.168.64.1:3001/ 2>&1 | head -1 && echo "3001 ok" || echo "3001 FAIL"
'
```

#### Full fix chain (apply in order when container sessions fail)

| # | Symptom | Root Cause | Code Fix |
|---|---------|-----------|---------|
| 1 | `host.docker.internal` unresolvable | Not built-in for Apple Container | `CONTAINER_HOST_GATEWAY` = `appleContainerBridgeIp()` in `src/container-runtime.ts` |
| 2 | Credential proxy unreachable | `detectProxyBindHost()` returns `127.0.0.1` for darwin | Returns `appleContainerBridgeIp()` when `IS_APPLE_CONTAINER_RUNTIME` |
| 3 | API returns 404 | Credential proxy drops upstream base path (`/anthropic`) | `forwardPath = basePath + req.url` in `src/credential-proxy.ts` |
| 4 | Linear/Notion tools throw "Missing API key" | `process.env.LINEAR_API_KEY` not set in launchd process | Use `readEnvFile(['LINEAR_API_KEY'])` fallback in `symphony-linear.ts` and `symphony-notion.ts` |
| 5 | Wrong model error | `ANTHROPIC_DEFAULT_SONNET_MODEL` not forwarded | Inject `-e ANTHROPIC_DEFAULT_SONNET_MODEL=...` in `src/container-runner.ts` |
| 6 | MCP URLs still use `host.docker.internal` | Hardcoded in agent-runner | Use `process.env.CONTAINER_HOST_GATEWAY` in `container/agent-runner/src/index.ts` |

#### Internet access (if containers can't reach external URLs)

```bash
# Enable IP forwarding
sudo sysctl -w net.inet.ip.forwarding=1

# Enable NAT (replace en1 with active interface: route get 8.8.8.8 | grep interface)
echo "nat on en1 from 192.168.64.0/24 to any -> (en1)" | sudo pfctl -ef -
```

Make persistent: add `net.inet.ip.forwarding=1` to `/etc/sysctl.conf`, NAT rule to `/etc/pf.conf`.

| Symptom | Cause | Fix |
|---------|-------|-----|
| `curl: (28) Connection timed out` | IP forwarding disabled | `sudo sysctl -w net.inet.ip.forwarding=1` |
| HTTP works, HTTPS times out | IPv6 DNS resolution | Add `NODE_OPTIONS=--dns-result-order=ipv4first` |
| Container API returns 404 | Credential proxy path bug | Fix `forwardPath` in `src/credential-proxy.ts` (see fix #3 above) |

#### Launchd env var isolation

NanoClaw started via `launchctl` does **not** have `.env` vars in `process.env`. Any module that reads API keys must use `readEnvFile(['KEY_NAME'])` as a fallback — never rely on `process.env.LINEAR_API_KEY` etc. alone. The `credential-proxy.ts` is the reference implementation.

---

## Service Start/Stop

### Decision Tree

```bash
launchctl list | grep "com.nanoclaw$"
```

| Output | State | Action |
|--------|-------|--------|
| `<PID> 0 com.nanoclaw` | Running | `launchctl kickstart -k gui/$(id -u)/com.nanoclaw` to restart |
| `- 0 com.nanoclaw` | Registered but stopped | `launchctl kickstart gui/$(id -u)/com.nanoclaw` |
| _(no output)_ | Not registered | Check for manual process, then register |

### Manual Process → launchd

```bash
kill $(ps aux | grep "node.*dist/index" | grep -v grep | awk '{print $2}')
sleep 2
npx tsx setup/index.ts --step service
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.nanoclaw.plist
```

### Fresh Start

```bash
npm run build
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.nanoclaw.plist
```

### Stale launchd registration

If `launchctl load`/`bootstrap` returns `Input/output error`, or
`launchctl print gui/$(id -u)/com.nanoclaw` stays at `state = spawn scheduled`
with `last exit code = 1`, clear the stale job before re-registering:

```bash
launchctl bootout gui/$(id -u)/com.nanoclaw
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.nanoclaw.plist
```

Then inspect the real failure in `logs/nanoclaw.error.log` before retry loops.

### Native module ABI mismatch after npm install

If `logs/nanoclaw.error.log` shows `better_sqlite3.node` compiled against the
wrong `NODE_MODULE_VERSION`, rebuild it with the same Node binary used by the
launch agent instead of the shell-default Node:

```bash
SERVICE_NODE="$(launchctl print gui/$(id -u)/com.nanoclaw | awk '/program = /{print $3; exit}')"
export PATH="$(dirname "$SERVICE_NODE"):$PATH"
(cd node_modules/better-sqlite3 && npm run build-release)
launchctl kickstart -k gui/$(id -u)/com.nanoclaw
```

Verify with:

```bash
export PATH="$(dirname "$SERVICE_NODE"):$PATH"
node -e "const Database=require('better-sqlite3'); new Database(':memory:').close(); console.log('db-ok', process.version, process.versions.modules)"
```

### Stop Service

```bash
launchctl bootout gui/$(id -u)/com.nanoclaw
```

### Verify Health

```bash
bash scripts/jarvis-preflight.sh
```

If preflight fails only on `runtime owner row missing` and legacy
`worker_runs missing columns: run_generation stop_reason`, treat that as a
known stale diagnostic. Confirm actual health with:

```bash
launchctl print gui/$(id -u)/com.nanoclaw
tail -n 40 logs/nanoclaw.log
```

Healthy evidence is `state = running` plus `NanoClaw running` / `Connected to WhatsApp`
in the current log tail.

Plist: `~/Library/LaunchAgents/com.nanoclaw.plist` (`KeepAlive true`, `RunAtLoad true`).

### Main WhatsApp Lane Validation

Use this when the service is running and connected, but you need proof that the
main WhatsApp lane answers natural-language Andy status questions end to end.

Run the supported smoke with the same Node binary as the launch agent:

```bash
bash scripts/with-service-node.sh npx tsx scripts/test-main-lane-status-e2e.ts
```

If the shell-default Node shows `better_sqlite3.node` / `NODE_MODULE_VERSION`,
do not rebuild first. Re-run through `scripts/with-service-node.sh`; that is the
intended path for live DB-backed E2E probes.

If the probe times out:

```bash
tail -n 80 logs/nanoclaw.log
tail -n 80 logs/nanoclaw.error.log
sqlite3 store/messages.db "SELECT id, timestamp, content FROM messages WHERE id LIKE 'uat-main-%' ORDER BY timestamp DESC LIMIT 5;"
```

Interpretation:

- `uat-main-*` row present + retry loop in `logs/nanoclaw.log` = WhatsApp ingest worked; keep debugging runtime execution, not message delivery
- `ENOENT` / mount-path errors in `logs/nanoclaw.error.log` = agent staging or container mount failure (for example missing `container/skills/...` path)
- reply text present but missing status fields = control-plane/tooling regression, not transport failure

---

## Jarvis Worker Debug

### High-Signal Debugging (Use)

1. `bash scripts/jarvis-ops.sh trace --lane andy-developer` — timeline + root-cause markers
2. `bash scripts/jarvis-ops.sh incident-bundle --window-minutes 180 --lane andy-developer` — repeatable evidence
3. DB checks (`andy_requests`, `worker_runs`, dispatch-block artifacts) before chat-text interpretation
4. E2E repro scripts (`test-andy-full-user-journey-e2e.ts`, `test-andy-user-e2e.ts`)
5. Deterministic reruns (`verify-worker-connectivity`, `linkage-audit`, acceptance gate)

### Low-Signal Debugging (Avoid)

- Probe-only loops without trace/DB correlation
- Declaring success from `reliability` pass/warn alone
- Parsing chat text as truth when DB fields exist
- Grepping entire historical log after restart

### Root Cause → Fix Patterns

| Symptom | Root Cause | Fix | Verify |
|---------|-----------|-----|--------|
| `invalid dispatch payload` + no `worker_run_id` | Missing linkage field at dispatch | Inject field at composition time | E2E shows `request_id -> worker_run_id` linkage |
| `No channel for JID: jarvis-worker-*@nanoclaw` | Root runtime lost internal dispatch | Restore `src/index.ts` + `src/ipc.ts` internal handling | `verify-worker-connectivity` PASS |
| `context_intent=continue` validator block | No reusable session, blocked request not terminal | Mark blocked request `failed` with reason | E2E + `linkage-audit` PASS |
| Worker `failed_contract` from stale completion | Wrong completion block parsed | Parse latest valid block + regression test | Probe transitions to `review_requested` |

### Worker Build Failures

If buildkit DNS fails: use `container/worker/build.sh` artifact flow. Validate: `container images | rg nanoclaw-worker`.

### Delegation Authorization

- `main` → any group: allowed
- `andy-developer` → `jarvis-worker-*`: allowed
- Non-main/non-Andy → cross-group: blocked

If delegation fails, verify `src/ipc.ts` authorization gates first.

### E2E Smoke Gate

```bash
npx tsx scripts/test-worker-e2e.ts
```

Pass: Andy uses `nanoclaw-agent:latest`, worker uses `nanoclaw-worker:latest`, dispatch validates, completion validates, `worker_runs.status == review_requested`.

---

## Troubleshooting

### Quick Status Check

```bash
launchctl list | grep nanoclaw
container ls -a | rg nanoclaw
grep -E 'ERROR|WARN' logs/nanoclaw.log | tail -20
grep -E 'Connected to WhatsApp|Connection closed' logs/nanoclaw.log | tail -5
```

### Common Errors

| Error | Cause | Fix |
|-------|-------|-----|
| Container timeout | Runtime not fully started | Check container logs, retry |
| Agent not responding | Messages not processing | Check `grep 'New messages' logs/nanoclaw.log` |
| Mount REJECTED | Invalid mount config | Check `~/.config/nanoclaw/mount-allowlist.json` |
| QR code requested | Auth expired | `npm run auth` |
| WhatsApp disconnected | Session lost | `npm run auth && npm run build && launchctl kickstart -k gui/$(id -u)/com.nanoclaw` |
| Service crash loop | Bad build or missing env | Check `logs/nanoclaw.error.log` |
| `ERR_FS_CP_EINVAL` | Skill staging self-copy | Update `src/container-runner.ts`, rebuild, restart |

### Log Locations

| Log | Path |
|-----|------|
| Main app | `logs/nanoclaw.log` |
| Main errors | `logs/nanoclaw.error.log` |
| Container runs | `groups/{folder}/logs/container-*.log` |

---

## Evidence Capture

```bash
bash scripts/jarvis-ops.sh incident-bundle --window-minutes 180 --lane andy-developer
```

For tracked incidents: `--incident-id <id>`.

## Output Contract

When using this skill, report:

1. Commands executed and pass/fail result.
2. Root cause (or current best hypothesis) backed by logs/trace.
3. Next concrete action.
4. Incident ID/state if tracking applies.

## Notes

- For incident lifecycle, update `.claude/progress/incident.json`.
- Docker commands are legacy fallback only; default is `container` + `jarvis-ops`.
