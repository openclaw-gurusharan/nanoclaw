---
name: weekly-cleanup
description: |
  Weekly slop optimization workflow. Use for scheduled docs/scripts/config pruning.
  Do NOT use for reactive session introspection.
---

# Weekly Cleanup

Deterministic weekly workflow for reducing code, config, scripts, and docs slop.

## Cadence

Run once per week (45-90 min) on branch `chore/slop-prune-YYYY-MM-DD`.

## 4-Area Checklist

1. `docs/` — stale/duplicate/unreferenced docs
2. `scripts/` — duplicate or orphaned scripts
3. Config surfaces — `.Codex/`, `.codex/`, `.github/workflows/`, `config-examples/`
4. Implementation — `src/`, `container/` for unresolved debt markers

## Automation Commands

```bash
# Preflight
bash scripts/workflow/preflight.sh --skip-recall

# Inventory checks
bash scripts/check-workflow-contracts.sh
bash scripts/check-Codex-codex-mirror.sh
bash scripts/check-tooling-governance.sh

# Prevention sweep
bash scripts/jarvis-ops.sh weekend-prevention \
  --skip-preflight --skip-acceptance \
  --json-out data/diagnostics/weekend-prevention/latest-manifest.json

# Find unreferenced assets
bash scripts/workflow/slop-inventory.sh --list-unreferenced-docs
bash scripts/workflow/slop-inventory.sh --list-unreferenced-scripts
bash scripts/workflow/slop-inventory.sh --summary

# Debt markers
rg -n --glob '!docs/**' --glob '!.Codex/**' --glob '!node_modules/**' '\b(TODO|FIXME|HACK|XXX)\b' src scripts container
```

## Queue Sizing (per week)

| Severity | Max |
|----------|-----|
| P0 (broken contracts/mirror drift) | Fix all |
| P1 (unreferenced/duplicate files) | 2 deletions + 2 consolidations |
| P2 (debt markers, trigger tuning) | 3 small refactors |

## Customization-Only Simplify Path

For fork-owned customization simplification (not upstream refactoring):

1. Work on dedicated branch/worktree
2. Read `docs/ARCHITECTURE.md` first
3. Default targets: `src/extensions/jarvis/*`, `scripts/jarvis-*`, `groups/*`

## Verification Gate

```bash
npm run build
npm test
bash scripts/check-workflow-contracts.sh
bash scripts/check-Codex-codex-mirror.sh
bash scripts/check-tooling-governance.sh
bash scripts/jarvis-ops.sh acceptance-gate
```

## Context Budget Rules

A rule stays in `.Codex/rules/` (auto-loaded) only if ALL true:

1. Applies in >=80% of sessions
2. Silent/wrong behavior without it
3. Under ~150 tokens

Otherwise: move to `docs/` and add trigger line.
