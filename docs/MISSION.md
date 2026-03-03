# Mission

A personal AI software engineering team, accessible via WhatsApp.

---

## What This Is

You send a WhatsApp message. The system ships production-quality code.

```
You (WhatsApp)
    │  "add a dark mode toggle to settings"
    ▼
Andy — understands intent, clarifies, plans
    │
    ▼
Andy-developer Frontdesk — user-facing conversation, natural status, instant acknowledgement
    │
    ▼
Andy-developer Coordinator — admin orchestration, request tracking, worker contracts
    │
    ▼
Jarvis workers — executes code, commits to branch, opens PR
    │
    ▼
You — PR link in WhatsApp
```

## Philosophy

**Humans steer. Agents execute.**

You are the architect and director. The agents are the engineering staff. You describe what you want — the system figures out how, implements it, and delivers a PR.

## Quality Contract

Every worker task must produce:

- A committed branch with real code changes
- Passing acceptance tests
- A PR (or explicit skip reason)
- A risk assessment

The pre-exit gate re-invokes workers if the completion contract is incomplete. No half-baked output reaches you.

## Why Three Tiers

| Tier | Role | Runtime |
|------|------|---------|
| Andy (main) | Your conversational interface. Understands context, memory, scheduling. | Claude Code |
| Andy-developer | Dual role in one lane: Frontdesk (user-facing) + Coordinator (internal team lead). | Claude Code |
| Jarvis workers | Bounded code execution. Write code, run tests, commit, open PRs. | OpenCode |

Each tier runs in an isolated container with its own filesystem, memory, and IPC namespace. Cross-tier escalation is blocked by authorization gates.

## Non-Main Lane Contract (Andy-developer)

- Frontdesk is always conversational and low-latency for greetings, status, and new-task intake.
- Users should never be forced to remember internal request IDs for normal status checks.
- Coordinator handles internal request IDs, dispatch contracts, retries, and worker supervision.
- Frontdesk and Coordinator must not create duplicate logic paths; Frontdesk summarizes, Coordinator executes.

## Reliability and Recovery Contract

- Service restarts must preserve continuity from durable state (messages, requests, worker runs, sessions).
- In-flight coordination should recover safely after restart without duplicating worker dispatches.
- User-visible status must remain available during/after recovery, without exposing raw internal errors.
- Any newly discovered issue is incident-tracked; any new feature request is feature-tracked before implementation.
