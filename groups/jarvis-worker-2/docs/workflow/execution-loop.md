# Execution Loop

## Role Handoff

1. `Andy-bot`: observe/research and send concise handoff context.
2. `Andy-developer`: issue strict JSON dispatch (`run_id`, branch, tests, output contract).
3. `jarvis-worker-*`: execute bounded task and return `<completion>` for review.

`Andy-bot` does not dispatch worker tasks directly.

## Decision Tree by Task Type

```
Task received
    │
    ├─► NEW PROJECT?
    │       └─► initialization skill (INIT state)
    │
    ├─► FEATURE? (has feature-list.json)
    │       └─► implementation skill (IMPLEMENT state)
    │               └─► UI-impacting delta?
    │                       ├─► YES → browser-testing skill (container Chromium gate, default)
    │                       └─► NO  → continue
    │
    ├─► TESTING?
    │       ├─► UNIT/API ──► testing skill
    │       └─► BROWSER ──► browser-testing skill (chrome-devtools MCP)
    │
    ├─► RESEARCH? (URL/article shared)
    │       └─► research-evaluator skill
    │
    └─► PARALLEL? (3+ features)
            └─► worktree-orchestrator skill
```

---

## DESIGN Phase

**When task needs architecture/design decisions:**

1. Check `## Prior Knowledge` block for precedents from prior runs
2. If precedent exists → use it
3. If new decision → include in `learnings` field at completion
4. Continue to implementation

**Store decision trace:**

```
context_store_trace(
  decision="<what you chose>",
  category="architecture|framework|api",
  outcome="pending"
)
```

---

## FIX ISSUES Loop

```

### Container/Runtime Debug Fast Path

When worker execution/build path fails:

1. Check runtime: `container system status`, `container builder status`.
2. If control commands hang, recycle cleanly:
   - kill stuck `container ...` CLI commands
   - `container system stop`
   - `container system start`
   - `container builder start`
3. Rebuild worker image with artifact flow: `./container/worker/build.sh`.
4. Re-run smoke: `npx tsx scripts/test-worker-e2e.ts`.
Detect failure
    │
    ├─► Investigate (logs, tests, code)
    │
    ├─► Fix (self-heal)
    │
    ├─► Re-test (exit code 0?)
    │       ├─► YES → continue
    │       └─► NO → repeat fix loop (max 3x)
    │
    └─► Still failing?
            ├─► YES → raise GitHub issue, continue with other work
            └─► NO → done
```

---

## Server Management

| Action | Command |
|--------|---------|
| Start dev server | Check package.json scripts, run in background |
| Verify running | curl localhost:<port>/health |
| Stop server | pkill -f or kill PID |

**Rule:** Start before browser test, stop after.

---

## Browser Testing (Container Chromium)

Required by default for UI-impacting changes.
For any feature that changes user-visible behavior, validation must prove the affected flow, not only low-level tests.

**REQUIREMENTS:**

1. In-container Chromium available at `/usr/bin/chromium`
2. `chrome-devtools` MCP is available and starts successfully
3. Server must be running inside the same container
4. Use container-local route (`127.0.0.1`) for browser assertions
5. If browser tooling is unavailable, report blocker to Andy-developer (do not claim pass)
6. DOM fallback allowed only when dispatch explicitly permits fallback

**Verification before testing:**

Run readiness probe first, then execute at least one `chrome-devtools` MCP action.

**Assertion execution:**

Include tool names and key outputs in completion evidence.
Exercise the changed user flow: load, interact, observe the expected state change, and verify relevant success or error behavior.
If that required validation reveals a regression inside dispatched scope, fix it before returning completion.

**If browser tooling is unavailable:**

- Report exact browser/MCP blocker with command output
- Fallback: Use DOM scraping only if dispatch explicitly allows fallback

---

## GitHub Operations

| Operation | Account | Method |
|-----------|---------|--------|
| Clone | openclaw-gurusharan | GH_CONFIG_DIR=~/.jarvis/gh-config |
| Push | openclaw-gurusharan | auto from config |
| PR | openclaw-gurusharan | `gh pr create` — include `@claude` only if Andy/project policy requires |
| Issue | openclaw-gurusharan | `gh issue create` |

**Branch naming:** `jarvis-<feature>`

**All tokens auto-available via direnv** — see `github-account-isolation.md` for full env map.

---

## Control-Plane Boundary

GitHub delivery-governance tasks are owned by `andy-developer`:

- repository secrets setup (`gh secret set ...`)
- branch protection/ruleset changes
- `.github/workflows/*` governance updates

Workers stay focused on implementation/test execution and should escalate control-plane requests to Andy-developer.

Execution-state ownership is external to workers:

- Linear owns task state, assignee, and readiness
- Notion owns shared context and design or research background
- GitHub Issues may be referenced for delivery history, but workers do not manage project-board state
- if dispatch includes a Linear issue key or GitHub Issue number, include it unchanged in execution output and handoff artifacts
  - leave completion evidence or PR link on the same issue before handoff only when explicitly instructed by Andy

---

## Self-Heal Triggers

| Problem | Action |
|---------|--------|
| GH_TOKEN invalid | Re-auth via keyring: `gh auth refresh` |
| Server won't start | Check port, kill existing, retry |
| Tests fail | Fix + re-run, don't ask |
| Browser tooling unavailable | Report blocker, skip browser tests |
