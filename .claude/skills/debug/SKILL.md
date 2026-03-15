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

Containers need manual networking setup for internet access:

```bash
# Enable IP forwarding
sudo sysctl -w net.inet.ip.forwarding=1

# Enable NAT
echo "nat on en0 from 192.168.64.0/24 to any -> (en0)" | sudo pfctl -ef -
```

Replace `en0` with active interface: `route get 8.8.8.8 | grep interface`

| Symptom | Cause | Fix |
|---------|-------|-----|
| `curl: (28) Connection timed out` | IP forwarding disabled | `sudo sysctl -w net.inet.ip.forwarding=1` |
| HTTP works, HTTPS times out | IPv6 DNS resolution | Add `NODE_OPTIONS=--dns-result-order=ipv4first` |
| `Could not resolve host` | DNS not forwarded | Check bridge100, verify pfctl NAT rules |

Make persistent: add `net.inet.ip.forwarding=1` to `/etc/sysctl.conf`, NAT rule to `/etc/pf.conf`.

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

### Stop Service

```bash
launchctl bootout gui/$(id -u)/com.nanoclaw
```

### Verify Health

```bash
bash scripts/jarvis-preflight.sh
```

Plist: `~/Library/LaunchAgents/com.nanoclaw.plist` (`KeepAlive true`, `RunAtLoad true`).

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
