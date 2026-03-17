---
name: session-introspection
description: |
  Required closure workflow when a session caused avoidable friction.
  Do NOT wait for user reminder — evaluate proactively at session end.
---

# Session Introspection

When an agent discovers documented workflows are stale, misleading, or rough during execution, use this to update them.

## Trigger Conditions (ALL must be true)

1. Task is complete (or session ending)
2. Agent encountered avoidable friction following a documented workflow
3. Agent had to improvise, retry, clarify, or correct course
4. Friction was preventable with better workflow guidance
5. Same friction could recur for other agents

## Separation of Concern

| Layer | Owns |
|-------|------|
| Workflow docs | Execution order, prerequisites, degraded paths, verification |
| Scripts | Executable contract for the workflow |
| `AGENTS.md` / `AGENTS.md` | Discovery timing and trigger routing |
| Incident docs | Product/runtime failures (not workflow debt) |
| Strategy docs | Higher-level process design |

## 7 Friction Categories

1. Unclear next step while following documented workflow
2. Missing prerequisite or auth/setup expectation
3. Misleading verification step
4. Discovery timing too late
5. Repeated retries or workaround commands
6. Missing degraded-mode or recovery guidance
7. Ambiguity between two plausible workflow paths

## Update Workflow

### Phase 1: Capture friction

- What made execution rough?
- How did it slow or distort execution?
- Root cause: instruction missing, unclear, wrong timing?

### Phase 2: Locate right doc

| Mistake Type | Update |
|---|---|
| Task execution | `docs/workflow/delivery/nanoclaw-development-loop.md` |
| Git/push/PR | Development loop Phase 7 |
| Startup/recall/sweep | `docs/workflow/runtime/session-recall.md` |
| Docs confusion | `.Codex/rules/docs-governance.md` |
| Governance | `/weekly-cleanup` skill |

### Phase 3: Update the workflow

- Add/clarify instruction, reorder phases, add degraded-path
- Replace misleading verification with reliable check

### Phase 4: Update AGENTS.md trigger (if needed)

Template: `BEFORE <action> → read docs/workflow/<path>.md`

### Phase 5: Verify

Re-read updated workflow — would it prevent original friction?

## Session Recall Check

```bash
bash scripts/qmd-context-recall.sh "<workflow/topic>"
node scripts/workflow/session-context-audit.js --top 10
```

## Exit Criteria

1. Friction identified concretely
2. Root cause identified
3. Workflow doc updated with smoother guidance
4. Recovery/degraded path added when needed
5. AGENTS.md trigger verified
6. Self-test passes
