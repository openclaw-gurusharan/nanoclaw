# Andy-Developer GitHub Workflow

This is mandatory for Andy-developer.

## Authentication

This lane uses the dedicated OneCLI agent `andy-developer`.

- GitHub credentials are assigned in the OneCLI dashboard and injected by the
  OneCLI gateway at request time.
- Do not expect a real `GH_TOKEN` / `GITHUB_TOKEN` value in the container
  environment.
- Do not ask the user to run `gh auth login` for normal lane operations.
- Use plain HTTPS GitHub URLs and let the proxy inject the lane-scoped secret.

Anthropic auth is separate and remains host-provided through NanoClaw's local
credential proxy.

Capability check rule:

- If asked whether this lane can access GitHub, verify by attempting the
  GitHub action or API call through the current runtime path.
- Do not infer "no access" just because `gh auth status` lacks a stored local
  login session.

## Branch Policy

- Never commit directly to `main`.
- Use worker branches only (`jarvis-<feature>`) for product execution tasks.
- Keep `main` as review-protected integration branch.
- Merge to `main` only via pull request.
- Seed worker branches remotely before dispatch (create from approved base, then push).

## Operating Model

1. Andy-developer identifies `base_branch` (default `main`) and creates `jarvis-<feature>` branch.
2. Andy-developer pushes the seeded branch to origin.
3. Andy-developer prepares strict dispatch JSON with `base_branch` + `branch`.
4. Andy-developer sends dispatch to `jarvis-worker-*`.
5. Worker checks out the dispatched `jarvis-<feature>` branch, applies fix, and pushes updates.
6. Worker returns completion contract with test evidence and commit SHA.
7. Andy-developer reviews code and sends `approve` or `rework`.
8. If approved, Andy-developer syncs the approved branch/commit into `NanoClawWorkspace` under `/workspace/extra/repos` and runs checks on that same branch/commit only.
9. Andy-developer runs local preflight (`build` + `server start/health`), verifies no duplicate same-lane running containers, and sends user testing handoff (user-run local commands).
10. If not approved and rework is large enough to warrant Jarvis, Andy-developer delegates rework to Jarvis using a new child `run_id`, the same `request_id`, and `parent_run_id` pointing at the reviewed run.

Use plain HTTPS GitHub remotes, for example:

```bash
git clone https://github.com/openclaw-gurusharan/nanoclaw.git
```

## Ownership Split

- `Andy-developer` owns control-plane changes:
  - `.github/workflows/*`
  - review/merge policy docs
  - dispatch/review process docs
- `jarvis-worker-*` owns product implementation changes in repository source.

## Board Target

- Use `Andy/Jarvis Delivery` for user-requested project execution work.
- Use `NanoClaw Platform` for NanoClaw/runtime/governance changes.
- If project delivery is blocked by platform work, open/link a separate platform Issue instead of tracking one item on both boards.

## Delivery Tracking Workflow

When a user asks for project work and GitHub project tracking is in use:

1. create or reuse one GitHub Issue for the request in `ingpoc/nanoclaw`
2. add that Issue to the `openclaw-gurusharan` `Andy/Jarvis Delivery` Project
3. keep `Agent=andy-developer` as the primary owner for the life of the request
4. include the GitHub Issue number in the worker dispatch context when Jarvis is used
5. let the host/runtime sync `Workflow Status`, `Worker`, `Request ID`, `Run ID`, `Branch`, `PR URL`, `Last Evidence`, and `Next Action`
6. do not rely on worker-authored board edits or label flips for execution tracking
7. do not duplicate the same execution item on `NanoClaw Platform`

Delivery state vocabulary:

- `Triage`
- `Architecture`
- `Ready`
- `Worker Running`
- `Review`
- `Blocked`
- `Done`

## Completion Criteria

Before saying "done", include:

- `run_id`
- branch name
- confirmation that preflight/handoff was run on the same approved branch/commit under test
- tests executed + result
- local review preflight (`build` + `server start/health`) result for user testing
- duplicate-container check result (`container ls -a` snapshot or equivalent)
- risk summary
- `pr_url` or `pr_skipped_reason`

## Prohibited

- Initial product source implementation by Andy-developer when the task should be worker-owned
- Large product feature/fix commits from Andy lane during review
- Any direct push to `main`

## Allowed Push Scope

- Control-plane changes (`.github/workflows`, review/branch-governance docs)
- Branch seeding pushes for worker lanes (`jarvis-*` pre-created from `base_branch`)
- Review-time bounded direct patches on the same approved worker branch when the delta is small, local, and clearly cheaper than redispatch
- Review/handoff staging operations that do not author product feature code

## Required Repo Controls

- Branch protection/ruleset on `main` must require PRs and required checks.
- Direct push to `main` must remain blocked for all automation lanes.
