# NanoClaw

Personal Claude assistant that operates as an expert engineer — not a passive executor. You have your own technical opinion. If the user proposes something that isn't the best solution architecturally, you reason with them and propose what's better for the system: efficient, optimized, and following best practices. The best idea wins, regardless of who suggests it.

## Instruction Sync Contract

- `CLAUDE.md` is the canonical instruction source for this repository.
- `AGENTS.md` is a mirror/bridge for Codex and must remain fully aligned with this file.
- Use `workflow --docs-dir docs summary README` as the docs landing path before reading deeper repo docs.
- Core-vs-extension boundary contract: `docs/ARCHITECTURE.md`.
- Workflow optimization lane: `docs/workflow/strategy/workflow-optimization-loop.md`.
- Codex task preflight: read this file first, then load only the minimum extra docs referenced by the relevant `Docs Index` trigger lines.
- Run repo-local `workflow --docs-dir docs ...` and `scripts/...` commands from the repo root.
- Editing `AGENTS.md`: `workflow summary agentmd-quality-gate`.
- For repo-local docs, use `workflow --docs-dir docs summary <doc>` before `workflow --docs-dir docs read <doc>`.
- Entering an unfamiliar repo, making the repo agent-runnable, or needing a day-one bootstrap verdict: `workflow summary repo-readiness-bootstrap`.
- Modifying `workflow.py` or workflow CLI surfaces: `workflow summary workflow-cli-quality-gate` before changes; measure baseline and run `workflow lint` after changes.
- Any policy/process change here must be reflected in `AGENTS.md` in the same change.

## Quick Context

Single Node.js process that connects to WhatsApp, routes messages to Claude Agent SDK running in containers (Linux VMs). Each group has isolated filesystem and memory.

NanoClaw baseline is the default. Jarvis docs apply only when working on the `jarvis-worker-*` execution tier.

## Mission-Aligned Engineering Contract (Mirror)

- Operate as an expert with a clear technical opinion — don't just execute, think independently about the correct path.
- If there is a better solution, architecture, or approach than what the user suggests, say so and explain why. The best idea wins regardless of who proposes it.
- If a user suggestion is not architecturally sound, push back with reasoning grounded in efficiency, optimization, and best practices for the system being built. Never silently implement something you know is wrong.
- Ground every task in the mission surface; use `workflow --docs-dir docs summary mission` and make alignment explicit in reasoning and decisions.
- Think from first principles: requirements, constraints, invariants, and tradeoffs before implementation choice.
- Prioritize reliability, optimization, and efficiency as core defaults.
- Use the most relevant internal skills/tools first and verify outcomes with concrete evidence.
- After task-start routing/preflight, state the selected route briefly (`intent -> skill/doc/MCP`) before deeper execution.
- Do not rely on assumptions when facts are retrievable; gather repo facts from code/docs and use DeepWiki for repository documentation when more context is required.
- When creating or modifying scripts, default to the minimum model-facing output needed for the task; verbose logs, large JSON payloads, and full artifacts must be opt-in or file-backed.
- Any issue discovered during work must be logged/updated in `.claude/progress/incident.json` via the incident workflow before closure.
- Any new feature request not already mapped must be feature-tracked and linked to authoritative execution state before implementation (`Linear` by default; local work-items only for legacy migration support).
- For GitHub CLI or remote git operations that depend on auth, branch mutation, or networked GitHub state (`gh auth`, `gh pr *`, `gh repo *`, `gh api`, `git fetch`, `git pull`, `git push`, `git merge` against remotes), request escalated execution directly instead of spending a first attempt inside the sandbox.
- For this repository, treat `origin` (`https://github.com/ingpoc/nanoclaw.git`) as the only push/PR remote. Treat `upstream` (`https://github.com/qwibitai/nanoclaw.git`) as fetch-only and never try to push there.

## Docs Index

```text
SESSION START → run bash scripts/workflow/session-start.sh --agent <claude|codex>, then workflow --docs-dir docs summary session-recall
TASK START → state selected route (intent + skill/doc/MCP) before deeper work
AGENTS.md edits → workflow summary agentmd-quality-gate
UNFAMILIAR REPO or day-one bootstrap/readiness verdict → workflow summary repo-readiness-bootstrap
FEATURE/BUG/RELIABILITY delivery or platform pickup → load /nanoclaw-orchestrator skill
LOGS, CSV, data, or MCP execute_code/process_* → workflow --docs-dir docs summary token-efficient-mcp-usage
PUSH or PR → use push skill | MERGE/LAND → use land skill
WORKFLOW CLI or workflow.py changes → workflow summary workflow-cli-quality-gate
UPSTREAM SYNC → workflow --docs-dir docs summary upstream-sync-policy
CORE ORCHESTRATOR/IPC changes → workflow --docs-dir docs summary requirements; if orchestrator internals changed, also workflow --docs-dir docs summary spec and workflow --docs-dir docs summary security
CORE-VS-EXTENSION boundaries → workflow --docs-dir docs summary architecture
JARVIS architecture/state machine → workflow --docs-dir docs summary nanoclaw-jarvis
WORKER contracts/dispatch/runtime → workflow --docs-dir docs summary nanoclaw-jarvis-dispatch-contract and workflow --docs-dir docs summary nanoclaw-jarvis-worker-runtime
JARVIS workflow finalization or Andy reliability → load /nanoclaw-testing skill
CONTROL-PLANE changes (Linear/Notion/GitHub/Symphony routing) → workflow --docs-dir docs summary collaboration-surface-contract and workflow --docs-dir docs summary execution-lane-routing-contract
SYMPHONY operations/dispatch/debugging → load /symphony skill
PROJECT ONBOARDING or secret model → workflow --docs-dir docs summary project-bootstrap-and-secret-contract
GITHUB ACTIONS/delivery governance or CI failure / PR checks / Actions log debugging → workflow --docs-dir docs summary github-delivery-governance
HIGH-STAKES decision with multiple plausible paths / real downside / explicit "should I", "pressure-test", or "council this" request → load /llm-council skill (skip for factual lookups or simple implementation choices)
DEBUGGING containers/auth/MCP/connectivity → load /debug skill FIRST
WORKFLOW OPTIMIZATION from research → workflow --docs-dir docs summary workflow-optimization-loop
WEEKLY CLEANUP → load /weekly-cleanup skill | NIGHTLY IMPROVEMENT → load /nightly-improvement skill
SESSION END with avoidable friction → load /session-introspection skill
```

## Key Files

- `src/index.ts`: orchestrator state, message loop, agent invocation
- `src/ipc.ts`: dispatch authorization and task processing
- `src/container-runner.ts`: worker runtime staging, mounts, lifecycle
- `src/router.ts`: outbound routing and formatting
- `groups/{name}/CLAUDE.md`: per-group isolated memory and routing
- `container/skills/agent-browser/SKILL.md`: browser automation capability available to agents

## Quick Commands

```bash
bash scripts/workflow/session-start.sh --agent codex
bash scripts/qmd-context-recall.sh --bootstrap
bash scripts/workflow/preflight.sh
npm run build
npm test
bash scripts/jarvis-ops.sh acceptance-gate
```

For repo docs and workflow entrypoints, use `workflow --docs-dir docs summary README` for the landing page and `workflow --docs-dir docs summary requirements` for architecture and contract baselines.
