# Repo Readiness Report

- Repo: /Users/gurusharan/Documents/remote-claude/active/apps/nanoclaw
- Stacks: node
- Repo class: service
- Web-facing: no
- Overall: degraded
- Can agent proceed now: with_limits
- Strongest verification command: ./scripts/jarvis-smoke.sh
- Strongest runtime proof lane: curl -fsS http://127.0.0.1:${port}/health
- Browser proof lane: not_applicable

| Lane | Phase | Status | Detected | Verified | Validation command | Next action |
|------|-------|--------|----------|----------|--------------------|-------------|
| Repo Contract | parallel_discovery | ready | yes | yes | n/a | none |
| Verification | parallel_discovery | degraded | yes | no | ./scripts/jarvis-smoke.sh | Run `./scripts/jarvis-smoke.sh` and capture pass/fail output before claiming readiness. |
| Environment Start | sequential_proof | degraded | yes | no | npm --prefix .nanoclaw/base run dev | Start the environment with `npm --prefix .nanoclaw/base run dev` before running runtime or browser proof. |
| Runtime Evidence | sequential_proof | degraded | yes | no | curl -fsS http://127.0.0.1:${port}/health | Run the runtime proof lane after startup and record the observed health or livez output. |
| Integrations | parallel_discovery | degraded | yes | no | best-effort non-destructive integration probes | Run non-destructive auth or reachability probes for repo-relevant integrations. |
| Guardrails | parallel_discovery | degraded | yes | no | npm --prefix .nanoclaw/base run lint | Strengthen deterministic guardrails with repo-owned checks, hooks, or CI policies. |
| DX Primitives | parallel_discovery | degraded | yes | no | n/a | Keep scripts, docs, and examples repo-owned and close to the workflows they describe. |

## Parallel Discovery

- repo_contract
- verification
- integrations
- guardrails
- dx_primitives

## Sequential Proof

- environment_start
- runtime_evidence

## Next Actions

1. Run `./scripts/jarvis-smoke.sh` and capture pass/fail output before claiming readiness.
2. Start the environment with `npm --prefix .nanoclaw/base run dev` before running runtime or browser proof.
3. Run the runtime proof lane after startup and record the observed health or livez output.
4. Keep scripts, docs, and examples repo-owned and close to the workflows they describe.
5. Strengthen deterministic guardrails with repo-owned checks, hooks, or CI policies.
6. Run non-destructive auth or reachability probes for repo-relevant integrations.