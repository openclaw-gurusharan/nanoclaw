---
name: nanoclaw-testing
description: "Use when validating NanoClaw feature changes with feature-mapped tests, reliability-focused verification, and fail-fast evidence. Load after nanoclaw-implementation or whenever you need targeted test commands for a feature id/query."
---

# NanoClaw Testing

Feature-aware testing that pulls test scope from the feature catalog.

## Workflow

### 1. Ensure catalog is fresh

```bash
npx tsx .claude/skills/feature-tracking/scripts/build-feature-catalog.ts
npx tsx .claude/skills/feature-tracking/scripts/validate-feature-catalog.ts
```

### 2. Run feature-scoped verification

```bash
npx tsx .claude/skills/nanoclaw-testing/scripts/run-feature-tests.ts "<feature-id-or-query>"
```

### 3. Live reliability verification (required for incident/reliability fixes)

```bash
npx tsx .claude/skills/nanoclaw-testing/scripts/run-feature-tests.ts "<feature-id-or-query>" --live
```

This enables runtime checks from `scripts/jarvis-ops.sh`. For Andy-facing reliability features it also runs `happiness-gate`.

### 4. Optional full-suite confirmation

```bash
npx tsx .claude/skills/nanoclaw-testing/scripts/run-feature-tests.ts "<feature-id-or-query>" --full
```

## Reliability Rules

- Always run `npm run typecheck`.
- For high-risk features (dispatch/container/worker lifecycle), run mapped tests and at least one integration-adjacent test where applicable.
- Fail fast: stop at first broken command, fix, rerun from top.
- For incident fixes, run with `--live` so ops verification from `scripts/jarvis-ops.sh` is included.
- For Andy user-facing reliability fixes, `--live` must include `bash scripts/jarvis-ops.sh happiness-gate --user-confirmation "<manual User POV runbook completed>"`.
- `happiness-gate` pass is not sufficient by itself; also complete manual user POV runbook in `docs/workflow/delivery/nanoclaw-andy-user-happiness-gate.md`.

## User Happiness Gate (Andy)

Run before declaring any Andy/Jarvis reliability fix complete.

```bash
bash scripts/jarvis-ops.sh happiness-gate --user-confirmation "<manual User POV runbook completed>"
```

| Criteria | Threshold |
|----------|-----------|
| Greeting response latency | <= 8s |
| Progress query response | <= 8s |
| Status query (no internal IDs) | <= 8s |
| Reply quality | Direct, actionable, no stack traces |
| Internal correctness | No unintended dispatches from status probes |

**User POV Runbook** (required once per release candidate):

1. Send development request to `andy-developer`
2. Ask naturally: "what are you working on right now?"
3. Ask follow-up: "what is the current progress?"
4. In main lane, ask about `andy-developer` status
5. Confirm replies are immediate, specific, no `req-*` IDs
6. Confirm answer quality feels human-helpful

Expanded form for debugging:

```bash
bash scripts/jarvis-ops.sh status
bash scripts/jarvis-ops.sh verify-worker-connectivity
bash scripts/jarvis-ops.sh linkage-audit
node --experimental-transform-types scripts/test-andy-user-e2e.ts
node --experimental-transform-types scripts/test-main-lane-status-e2e.ts
```

## Jarvis Acceptance Checklist

Required outcomes before marking NanoClaw-Jarvis integration changes complete.

### Architecture (Must Hold)

- [ ] Host loop remains orchestrator (`src/index.ts`, `src/container-runner.ts`, `src/ipc.ts`)
- [ ] No worker HTTP microservice introduced
- [ ] Non-worker groups keep existing Claude Agent SDK behavior
- [ ] Role split: Andy-bot (observe), Andy-developer (dispatch), jarvis-worker-* (execute)

### Dispatch/Completion (Must Hold)

- [ ] Worker dispatch is strict JSON (plain-text rejected)
- [ ] `run_id` is canonical and caller-provided
- [ ] Duplicate `run_id` does not double execute
- [ ] Retry bounded to `failed` and `failed_contract`

### Worker Runtime (Must Hold)

- [ ] Worker lanes use `nanoclaw-worker:latest`
- [ ] Worker secret scope is role-bounded
- [ ] Skills/rules staging is deterministic and read-only in-container

### Verification Gate

```bash
bash scripts/jarvis-ops.sh acceptance-gate
# For Andy-facing: add --include-happiness --happiness-user-confirmation "<runbook completed>"
```

Evidence: `data/diagnostics/acceptance/acceptance-<timestamp>.json`

## Evidence Format

`run-feature-tests.ts` prints a machine-readable JSON summary with:

- resolved feature id/name
- commands executed
- pass/fail per command
- manual checks required (when applicable)

Optional JSON artifact output:

```bash
npx tsx .claude/skills/nanoclaw-testing/scripts/run-feature-tests.ts "<feature-id-or-query>" --live --json-out data/diagnostics/tests/test-report.json
```

Use that JSON in commit/PR notes to prove validation scope.
