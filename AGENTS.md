# AGENTS.md

## Instruction Source

- Read and follow `CLAUDE.md` as the single source of truth for repository instructions, including upstream sync policy.
- At the start of every task, load `CLAUDE.md` first, then follow its `Docs Index` trigger lines for progressive disclosure.
- `docs/README.md` is the curated docs landing page; `DOCS.md` is the full inventory.
- At session start, run `bash scripts/workflow/session-start.sh --agent codex` so recall bootstrap, control-plane sweep, and workflow preflight happen in one enforced sequence before task work.
- At session start or when resuming interrupted work, follow `docs/workflow/runtime/session-recall.md` to reconstruct personal session context before loading project docs.
- Before changing the sweep protocol or agent-category affinity, load /setup skill.
- When session start is blocked by required Linear review or triage actions from the sweep, load /setup skill.
- Use `scripts/qmd-context-recall.sh` for recall-only workflows and `scripts/qmd-session-sync.sh` for session export sync + qmd update + git add/commit.
- Before ending a session with in-progress work or blockers, follow `docs/workflow/runtime/session-recall.md` handoff flow (`qctx --close`).
- Before changing session recall/sync/export behavior, follow `docs/workflow/runtime/session-recall.md`.
- Before creating a new docs file or adding a new `CLAUDE.md` trigger, follow `docs/workflow/docs-discipline/doc-creation-contract.md`.
- Before handling logs, CSV data, or potentially verbose script output, follow `docs/tools/token-efficient-mcp-usage.md`.
- Before bulk-reading Linear issues (list, triage, or scan >3 issues), follow `docs/tools/token-efficient-mcp-usage.md#linear-api-reads`.
- Before changing core-vs-extension ownership or adding Jarvis-specific logic to shared runtime files, follow `docs/ARCHITECTURE.md`.
- Run the task-start skill/MCP routing preflight defined by `CLAUDE.md` before ad-hoc implementation/debugging.
- After task-start routing/preflight, state the selected route briefly (`intent -> skill/doc/MCP`) before deeper execution.
- Before starting feature/bug/reliability implementation (default single-lane), load /nanoclaw-orchestrator skill.
- Before changing workflow strategy/cadence based on external research, follow `docs/workflow/strategy/workflow-optimization-loop.md`.
- After task completion or before ending a session, if a workflow caused avoidable friction, retries, or mid-task correction, load /session-introspection skill.
- Before changing nighttime improvement evaluation, overnight research cadence, or token-budgeted upstream/tooling scanning, load /nightly-improvement skill.
- Before running weekly docs/scripts/config/code slop cleanup during optimization cycles, load /weekly-cleanup skill.
- Before running simplify/refactor work on fork customizations, load /weekly-cleanup skill (see docs/ARCHITECTURE.md for fork design).
- Before reviewing hooks/subagents or built-in tool routing governance, follow `docs/workflow/strategy/weekly-slop-optimization-loop.md` and `docs/operations/tooling-governance-budget.json`.
- Before running parallel Claude/Codex worktrees or splitting execution/review ownership across tools (supersedes single-lane loop), load /nanoclaw-orchestrator skill.
- Before defining subagent fanout for plan/review/verification, follow `docs/operations/subagent-catalog.md` and `docs/operations/subagent-routing.md`.
- Before adapting behavior between Claude and Codex runtimes, follow `docs/operations/claude-codex-adapter-matrix.md`.
- Before deciding what to offload to GitHub Actions/rulesets vs keep in local lanes, follow `docs/workflow/github/github-offload-boundary-loop.md`.
- Before changing the Linear/Notion/GitHub control-plane split, follow `docs/workflow/control-plane/collaboration-surface-contract.md`.
- Before changing execution-lane routing or Symphony scope, follow `docs/workflow/control-plane/execution-lane-routing-contract.md`.
- Before changing custom Symphony backend routing or project registry, follow `docs/workflow/control-plane/custom-symphony-orchestration-contract.md`.
- Before writing or updating Symphony-routed Linear issues (Target Runtime, Agent field, Work Class), follow `docs/workflow/control-plane/custom-symphony-orchestration-contract.md#backend-selection-guide`.
- Before operating Symphony dispatch, daemon, or dashboard workflows, load /symphony skill.
- Before debugging Symphony nightly improvement dispatch or agent execution issues, load /symphony skill.
- Before onboarding a new project into Linear/Notion/Symphony or changing the universal secret model, follow `docs/workflow/control-plane/project-bootstrap-and-secret-contract.md`.
- Before consulting Claude Code CLI via resumed/forked sessions for parallel reasoning/review, follow `docs/workflow/delivery/claude-cli-resume-consult-lane.md`.
- If `AGENTS.md` and `CLAUDE.md` ever conflict, `CLAUDE.md` wins.

## Mission-Aligned Engineering Contract (Mirror)

- Ground every task in `docs/MISSION.md` and make alignment explicit in reasoning and decisions.
- Think from first principles: requirements, constraints, invariants, and tradeoffs before implementation choice.
- Operate as an expert with a clear technical opinion on the correct mission-aligned path.
- Prioritize reliability, optimization, and efficiency as core defaults.
- Use the most relevant internal skills/tools first and verify outcomes with concrete evidence.
- If a better mission-aligned approach exists, surface it proactively and reason with the user before execution.
- Do not rely on assumptions when facts are retrievable; gather repo facts from code/docs and use DeepWiki for repository documentation when more context is required.
- When creating or modifying scripts, default to the minimum model-facing output needed for the task; verbose logs, large JSON payloads, and full artifacts must be opt-in or file-backed.
- Any issue discovered during work must be logged/updated in `.claude/progress/incident.json` via the incident workflow before closure.
- Any new feature request not already mapped must be feature-tracked and linked to authoritative execution state before implementation (`Linear` by default; local work-items only for legacy migration support).
- For GitHub CLI or remote git operations that depend on auth, branch mutation, or networked GitHub state (`gh auth`, `gh pr *`, `gh repo *`, `gh api`, `git fetch`, `git pull`, `git push`, `git merge` against remotes), request escalated execution directly instead of spending a first attempt inside the sandbox.
- For this repository, treat `origin` (`https://github.com/ingpoc/nanoclaw.git`) as the only push/PR remote. Treat `upstream` (`https://github.com/qwibitai/nanoclaw.git`) as fetch-only and never try to push there.

## Skill Routing Mirror

- Runtime/auth/container failures route to `/debug`.
- Incident triage, recurring issue investigation, and incident lifecycle tracking load /debug skill.
- Incident lifecycle state is tracked in `.claude/progress/incident.json` (open/resolved + notes).
- Feature mapping/touch-set discipline routes to `feature-tracking`; feature execution tracking routes to `Linear` by default, with `nanoclaw-orchestrator` work items retained only for legacy migration support.
- Reliability validation can use `scripts/jarvis-ops.sh verify-worker-connectivity` after `preflight`/`trace`.
- Andy user-facing reliability sign-off should load /nanoclaw-testing skill and run `bash scripts/jarvis-ops.sh happiness-gate --user-confirmation "<manual User POV runbook completed>"`.
