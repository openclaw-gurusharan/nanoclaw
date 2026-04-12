---
name: session-introspection
description: |
  Required closure workflow when a session caused avoidable friction.
  Do NOT wait for user reminder — evaluate proactively at session end.
---

# Session Introspection

When execution caused avoidable friction, use this skill to choose the strongest lowest-cost anti-recurrence fix and update the correct owner surface.

## Trigger Conditions (ALL must be true)

1. Task is complete (or session ending)
2. Agent encountered avoidable friction following a documented workflow or owned command path
3. Agent had to improvise, retry, clarify, or correct course
4. Friction was preventable with better workflow guidance, tooling, or routing
5. Same friction could recur for other agents

## Separation of Concern

| Layer | Owns |
|-------|------|
| Workflow docs / skills | Execution order, prerequisites, degraded paths, verification |
| Scripts / lint / checks | Executable contract for owned command paths and deterministic misuse prevention |
| `CLAUDE.md` / `AGENTS.md` | Discovery timing and trigger routing |
| Hooks / deny rules | Narrow action-boundary blocking when pre-execution prevention is safer |
| Incident docs | Product/runtime failures (not workflow debt) |
| Strategy docs | Higher-level process design |

## Friction Categories

1. Unclear next step while following documented workflow
2. Missing prerequisite or auth/setup expectation
3. Misleading verification step
4. Discovery timing too late
5. Repeated retries or workaround commands
6. Missing degraded-mode or recovery guidance
7. Ambiguity between two plausible workflow paths
8. Deterministic misuse that should have been blocked mechanically

## Prevention Decision

For each friction item, choose the strongest lowest-cost control:

| If the friction came from... | Preferred fix |
|---|---|
| missing sequence, prerequisite, degraded path, or verification guidance | update workflow doc or skill |
| stale command example or deterministic misuse in one owned command family | add or tighten script, lint, or verification check |
| unsafe action across many call sites where blocking first is safer | add or tighten a narrow hook / deny rule |
| fresh-agent routing to the wrong owner surface | update `CLAUDE.md` / `AGENTS.md` trigger |

Do not default to `CLAUDE.md` / `AGENTS.md` just because friction occurred. Update triggers only when a fresh agent would still choose the wrong surface after the owner doc and owned checks are fixed.

## Update Workflow

### Phase 1: Capture friction

- What made execution rough?
- How did it slow or distort execution?
- Root cause: instruction missing, unclear, wrong timing, stale example, or missing mechanical guard?

### Phase 2: Choose the prevention surface

- Would a workflow doc or skill update prevent this?
- If the misuse is deterministic, should it be blocked by a script/lint/check instead?
- Is a hook actually required because the risky action can come from many call sites?
- Was the real failure that `CLAUDE.md` / `AGENTS.md` routed the agent to the wrong surface?

### Phase 3: Update the right owner

| Mistake Type | Update |
|---|---|
| Task execution / sequence / degraded path | `docs/workflow/delivery/nanoclaw-development-loop.md` or owning skill |
| Startup / recall / sweep | `docs/workflow/runtime/session-recall.md` |
| Debug / runtime verification path | owning debug or testing skill first; script/check if deterministic |
| Stale command usage or repeatable command misuse | owning script, lint, or verification check |
| Docs confusion / discovery timing | `CLAUDE.md` trigger only if routing is truly wrong |
| Governance / recurring cleanup debt | `/weekly-cleanup` skill |

### Phase 4: Apply the fix

- Add or clarify instruction, reorder phases, or add degraded path when this is workflow debt
- Replace misleading verification with a reliable check
- Add or tighten script/lint/check when the misuse is deterministic
- Add or tighten a narrow hook only when action-boundary blocking is the right control
- Update `CLAUDE.md` / `AGENTS.md` trigger only when fresh-agent routing needs correction

### Phase 5: Verify

- Re-read the updated surface
- Ask: would this prevent or materially reduce the original friction?
- Ask: is this the narrowest effective control?

## Session Recall Check

```bash
bash scripts/qmd-context-recall.sh "<workflow/topic>"
node scripts/workflow/session-context-audit.js --top 10
```

## Exit Criteria

1. Friction identified concretely
2. Root cause identified
3. Prevention surface chosen explicitly: workflow/skill, script/lint, hook, or trigger
4. Correct owner updated with the narrowest effective control
5. `CLAUDE.md` / `AGENTS.md` trigger checked only if routing was part of the failure
6. Self-test passes
