# NanoClaw System Architecture

Canonical architecture view for this NanoClaw codebase (including Jarvis extension).

Boundary ownership lives in [`docs/ARCHITECTURE.md`](../ARCHITECTURE.md). This file describes topology, not what layer owns each change.

## Control Owner

Owner for:
- `docs/architecture/nanoclaw-system-architecture.md` guidance, decisions, and maintenance in this document

Should not contain:
- policy, workflow detail, or implementation behavior that belongs in a more specific owner doc, skill, or enforcement surface

## What the System Does

You message Andy on WhatsApp → Andy plans and delegates → Jarvis workers build your projects autonomously → results tracked in Linear + Notion.

## End-to-End Flow

### Lane 1: User-Initiated (WhatsApp → Andy → Worker)

```text
YOU (WhatsApp)
  │  "@Andy build API rate limiting for Aadharchain"
  ▼
NANOCLAW (Host - single Node.js process)
  │  Message loop polls SQLite every 2s
  │  Matches @Andy trigger → resolves andy-developer group
  │  Spawns container with isolated filesystem + MCP tools
  ▼
ANDY DEVELOPER (Container - Claude Agent)
  │  A. Checks Linear: does project exist?
  │  B. Checks Notion: does workspace exist?
  │  C. If missing → bootstraps (creates Linear project + Notion root page)
  │  D. Creates Linear issue (AND-XX) with spec
  │  E. Builds dispatch payload → writes to data/ipc/
  │  F. Replies on WhatsApp: "Got it, coordinating with Jarvis"
  ▼
NANOCLAW (IPC Watcher - polls data/ipc/ every 1s)
  │  Picks up dispatch file
  │  Validates payload (schema, required fields, authorization)
  │  Spawns worker container
  ▼
JARVIS WORKER (Container - Claude Agent)
  │  A. Clones repo, creates branch
  │  B. Implements the feature
  │  C. Runs tests
  │  D. Comments on Linear issue with results
  │  E. Writes Notion memory entry
  │  F. Returns <completion> JSON → writes to data/ipc/
  ▼
NANOCLAW (Completion Handler)
  │  Validates completion contract
  │  Updates worker_runs in DB → notifies Andy
  ▼
ANDY DEVELOPER (gets notified)
  │  Reviews worker output → reports back on WhatsApp
  ▼
YOU (WhatsApp)
   "Done. AND-42 implemented, branch ready for review."
```

### Lane 2: Automated (Linear → Symphony → Agent)

```text
LINEAR (Issue marked "Ready")
  ▼
SYMPHONY DAEMON (polls Linear every 15s)
  │  Finds ready issues → selects backend (codex/claude-code/opencode)
  │  Provisions workspace → spawns agent subprocess
  ▼
AGENT (Codex or Claude Code)
  │  Works the issue → updates Linear → returns
  ▼
SYMPHONY (Reconciler)
  │  Detects completion → transitions issue state
  │  Posts results as Linear comment
```

### Component Map

```text
┌─────────────┐     SQLite      ┌──────────────────┐
│  WhatsApp    │───────────────▶│  NanoClaw         │
│  (Baileys)   │◀───────────────│  (Orchestrator)   │
└─────────────┘                 └──────┬────────────┘
                                       │ spawns containers
                        ┌──────────────┼──────────────┐
                        ▼              ▼              ▼
                   ┌─────────┐   ┌──────────┐   ┌──────────┐
                   │  Andy   │   │ Worker 1 │   │ Worker N │
                   │Container│   │Container │   │Container │
                   └────┬────┘   └────┬─────┘   └────┬─────┘
                        │             │               │
                   file IPC      file IPC        file IPC
                        │             │               │
                        ▼             ▼               ▼
              ┌───────────────────────────────────────────┐
              │  Host Services (never inside containers)  │
              │  • Credential Proxy (:3001) — API auth    │
              │  • Notion MCP (:7802) — Notion tools      │
              │  • Linear MCP (:7803) — Linear tools      │
              └───────────────────────────────────────────┘
```

### Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| File-based IPC | Security boundary — containers can't access host DB or sockets |
| Polling (not events) | Simplicity — predictable, debuggable, no message queue infra |
| Single Node.js process | "Small enough to understand" — no microservices |
| Per-request MCP servers | Stateless by design — no state leaks between requests |
| Credential proxy on host | Secrets never enter containers — proxy injects auth on forwarding |
| Two dispatch lanes | WhatsApp (user-initiated, real-time) + Symphony (automated, scheduled) |

## Layered Topology

1. **Host Orchestrator (NanoClaw core)**
   - Runtime: Node.js process
   - Files: `src/index.ts`, `src/group-queue.ts`, `src/ipc.ts`, `src/db.ts`, `src/container-runner.ts`, `src/runtime-ownership.ts`
   - Responsibilities: claim single-host runtime ownership, poll messages, route by group, queue execution, persist generic runtime state

2. **Jarvis Extension Layer**
   - Files: `src/extensions/jarvis/*`
   - Responsibilities: lane identity, Andy frontdesk semantics, dispatch authorization, request/linkage state transitions, synthetic worker JID compatibility, startup replay for Jarvis worker lanes

3. **Agent Runtime Tier**
   - `andy-bot`: `nanoclaw-agent` (observe/research lane)
   - `andy-developer`: `nanoclaw-agent` (dispatch/review lane)
   - `jarvis-worker-*`: `nanoclaw-worker` (bounded execution lane)

4. **Persistence + Control Plane**
   - SQLite for chat/task/session/run state
   - `runtime_owners` for single active host ownership and heartbeat tracking
   - `dispatch_attempts` for request-to-worker handoff auditability
   - Filesystem IPC per group under `data/ipc/<group>`
   - Contract lifecycle: `queued -> running -> review_requested|failed_contract|failed`

## Execution Boundaries

- Core orchestration remains in NanoClaw host files.
- Launchd `com.nanoclaw` is the default runtime owner; manual runs are an explicit override path.
- Jarvis policy belongs under `src/extensions/jarvis/*`, not as duplicated inline helper clusters in `src/index.ts`, `src/ipc.ts`, and `src/db.ts`.
- Worker behavior is contract-driven (dispatch/completion schema), not prompt-only.
- Non-worker groups retain Claude Agent SDK behavior.
- Jarvis worker runtime is isolated to `jarvis-worker-*` image routing and role policy.
- Internal lane identity is based on lane IDs; synthetic `@nanoclaw` JIDs remain adapter compatibility only.

## Delegation Model

- `main` can target any group.
- `andy-developer` can delegate only to `jarvis-worker-*`.
- `andy-bot` is observer/research only and does not dispatch worker tasks.

## Canonical State Split

- `andy_requests`: user-facing request lifecycle
- `dispatch_attempts`: each coordinator handoff attempt
- `worker_runs`: accepted worker execution runs

These are separate state machines. Blocked dispatch is not a worker run.

## Required Companion Docs

- `docs/architecture/nanoclaw-jarvis.md`
- `docs/workflow/runtime/nanoclaw-jarvis-dispatch-contract.md`
- `docs/workflow/runtime/nanoclaw-jarvis-worker-runtime.md`
- `docs/workflow/delivery/nanoclaw-jarvis-acceptance-checklist.md`
