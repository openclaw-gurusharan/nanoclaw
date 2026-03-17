# Container Browser Review Gate

Use this before dispatching or approving browser-testing work.

## Default Policy

- Browser testing must run inside worker containers by default.
- Use stable Chromium + `chrome-devtools` MCP.
- Validate routes through `http://127.0.0.1:<port>` inside the same container namespace.
- Require task-relevant user-flow validation for UI-impacting changes, not generic smoke-only browser checks.
- Treat browser-found regressions inside dispatched scope as worker-owned rework, not optional follow-up.

## Andy Decision Flow

1. Classify whether the task is UI-impacting.
2. For UI-impacting tasks, require in-container browser validation by default.
3. Require worker to run app server in-container, probe readiness, then run task-relevant browser flow assertions.
4. Allow DOM-only fallback only when explicitly approved.
5. Never require screenshots or screenshot analysis; they are prohibited for token/runtime reasons.

UI-impacting examples:
- edits under `src/app`, `src/components`, `pages`, `public`
- CSS/theme/layout/navigation changes
- changes affecting form behavior, client interactions, or rendered UX

## Dispatch Requirements For Browser Tasks

When creating worker dispatch JSON for browser work:

- Keep `task_type` bounded (`test` or `ui-browser`).
- In `input`, require:
  - in-container server startup command
  - readiness probe command
  - target route(s) on `127.0.0.1`
  - task-specific browser flow assertions covering the changed user path
  - explicit no-screenshot instruction (`no screenshots; use evaluate_script/curl/console output`)
- Require the worker to fix issues found during required browser validation before returning completion unless the fix is out of scope and escalated.
- Keep fallback explicit (`fallback_allowed: true`) only when approved.

## Evidence Required In Worker Completion

Require all of:

1. server startup command and readiness output
2. tested in-container URL(s)
3. flow steps exercised against the affected UI path
4. `chrome-devtools` MCP tool calls with key outputs
5. pass/fail decision tied to expected UI behavior
6. confirmation that no screenshot capture/analysis was used

Do not approve "passed browser tests" without browser-tool evidence.
Do not approve browser evidence that only proves page render when the change affects a real interaction flow.

## Review Outcomes

- Approve: readiness evidence + browser-tool evidence + expected behavior checks pass.
- Rework: missing readiness evidence, missing browser-tool output, smoke-only coverage for a flow change, ambiguous fallback, unfixed browser-found issue, or unbounded claims.
