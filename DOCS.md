# NanoClaw Documentation Map

Canonical classification for repository docs.

## Root Docs

- `README.md`: product overview, setup, philosophy
- `CLAUDE.md`: compressed trigger index for agent runtime behavior
- `DOCS.md`: top-level documentation classification (this file)
- `docs/README.md`: in-folder index for `docs/`
- `docs/MISSION.md`: mission statement and operating profile intent
- `docs/CHANGELOG.md`: active changelog for current documentation era

## `docs/architecture/`

- `docs/architecture/nanoclaw-system-architecture.md`: canonical system architecture and runtime tiers
- `docs/architecture/nanoclaw-jarvis.md`: Jarvis-on-NanoClaw architecture, delegation model, lifecycle
- `docs/architecture/harness-engineering-alignment.md`: harness-engineering principles mapped to this repo
- `docs/architecture/nanoclaw-architecture-optimization-plan.md`: prioritized Apple-Container-first optimization backlog (`P0`/`P1`/`P2`) with expected benefits
- `docs/architecture/architecture-audit.md`: architecture audit findings and recommendations
- `docs/architecture/mission-core-profile.md`: minimum mission profile and required runtime shape
- `docs/architecture/mission-optional-features.md`: optional mission profile features and boundaries

## `docs/workflow/`

- `docs/workflow/nanoclaw-jarvis-dispatch-contract.md`: strict dispatch/completion contract
- `docs/workflow/nanoclaw-jarvis-worker-runtime.md`: worker runtime, mounts, model fallback, role bundles
- `docs/workflow/nanoclaw-jarvis-acceptance-checklist.md`: acceptance and smoke validation gates
- `docs/workflow/nanoclaw-github-control-plane.md`: GitHub workflow/review control-plane rules
- `docs/workflow/nanoclaw-andy-user-happiness-gate.md`: user-facing reliability sign-off protocol
- `docs/workflow/nanoclaw-container-debugging.md`: container/auth/session debug workflow

## `docs/operations/`

- `docs/operations/roles-classification.md`: role authority and handoff model (`andy-bot`, `andy-developer`, workers)
- `docs/operations/update-requirements-matrix.md`: required doc/code update surfaces by change type
- `docs/operations/agreement-sync-protocol.md`: agreement-driven sync protocol for docs/code
- `docs/operations/skills-vs-docs-map.md`: decision boundary for skill-first vs docs-first execution
- `docs/operations/upstream-sync-policy.md`: upstream sync operating policy
- `docs/operations/runtime-vs-prebaked-boundary.md`: runtime-local vs prebaked placement policy
- `docs/operations/workflow-setup-responsibility-map.md`: ownership map for setup and workflow governance

## `docs/reference/`

- `docs/reference/REQUIREMENTS.md`: core constraints and product philosophy
- `docs/reference/SPEC.md`: baseline behavior/specification
- `docs/reference/SECURITY.md`: security model and trust boundaries

## `docs/troubleshooting/`

- `docs/troubleshooting/DEBUG_CHECKLIST.md`: debug flow for runtime/container/session failures
- `docs/troubleshooting/APPLE-CONTAINER-NETWORKING.md`: Apple container networking/build diagnostics
- `docs/troubleshooting/worker-dispatch-root-cause-2026-02-24.md`: root-cause analysis archive for worker dispatch incident

## `docs/archives/`

- `docs/archives/CHANGELOG-2026-02-26.md`: historical changelog snapshot prior to current changelog flow

## Worker-Local Workflow Docs

- `groups/jarvis-worker-*/docs/workflow/execution-loop.md`
- `groups/jarvis-worker-*/docs/workflow/worker-skill-policy.md`
- `groups/jarvis-worker-*/docs/workflow/git-pr-workflow.md`
- `groups/jarvis-worker-*/docs/workflow/github-account-isolation.md`

## Runtime Rules

- `container/rules/andy-bot-operating-rule.md`
- `container/rules/andy-developer-operating-rule.md`
- `container/rules/jarvis-worker-operating-rule.md`
- `.claude/rules/nanoclaw-jarvis-debug-loop.md`
- `.claude/rules/jarvis-dispatch-contract-discipline.md`
- `.claude/rules/andy-compression-loop.md`

## Maintenance Rule

When docs are added, moved, or removed:

1. Update `DOCS.md`.
2. Update `docs/README.md`.
3. Update root trigger links in `CLAUDE.md` if any trigger paths changed.
4. Keep `README.md` pointer to `DOCS.md` intact.
