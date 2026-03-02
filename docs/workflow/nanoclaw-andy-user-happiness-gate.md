# NanoClaw Andy User Happiness Gate

Release gate for `andy-developer` user-facing behavior.

This gate is intentionally user-centric:

1. The response must arrive fast enough to feel immediate.
2. The response content must directly answer the user.
3. Internal state handling must remain correct and stable.

## When To Run

Run before declaring any Andy/Jarvis reliability fix complete, and before any bloat-strip phase.

## Pass Criteria

### 1) User Perceived Latency

- Greeting (`hi`-style) response within `<= 8s`
- Progress query response within `<= 8s`
- `status <request_id>` response within `<= 8s`

### 2) User Response Quality

- Replies are direct and actionable (not generic filler).
- Progress/status replies include concrete state details (request state, run state, active count, or explicit no-run status).
- Replies do not contain stack traces, raw exceptions, or generic internal error dumps.

### 3) Internal Correctness

- Status/greeting probes do not trigger unintended worker dispatches.
- Status/greeting probes do not create `andy_requests` intake rows.
- Probe window must not introduce `running_without_container` regression failures.

### 4) Human Satisfaction Check (Required)

- Operator confirms: "As a user, I am satisfied with what I got, when I got it, and how the system behaved."

## Workflow

1. Run the consolidated gate command:
   - `bash scripts/jarvis-ops.sh happiness-gate`
2. If probe fails, do not proceed to strip-down.
3. Fix issue, rerun probe, and only continue when all checks pass.
4. Add or update incident note with probe evidence before closing incident.

Equivalent expanded form (for debugging):

- `bash scripts/jarvis-ops.sh status`
- `node --experimental-transform-types scripts/test-andy-user-e2e.ts`

## Probe Script

`scripts/test-andy-user-e2e.ts` validates:

- `@Andy hi` reply quality + latency
- `@Andy what is the current progress` reply quality + latency
- `@Andy status req-<unknown>` immediate "not found" behavior
- Internal guardrails for request/worker side effects

## Fail Handling

Treat any failure as blocking for release:

- UX latency/quality failure: fix router/frontdesk handling before release.
- Internal correctness failure: fix state transitions/side effects before release.
- Human satisfaction failure: tighten response style/behavior, then re-test.
