# Changelog

Tracks only the latest upstream sync outcome.
Previous entries are retained in git history only.

## Control Owner

Owner for:
- `docs/CHANGELOG.md` guidance, decisions, and maintenance in this document

Should not contain:
- policy, workflow detail, or implementation behavior that belongs in a more specific owner doc, skill, or enforcement surface

## [Unreleased]

### Bug Fixes

- fix(container): auto-configure OneCLI CA cert SSL env vars at container startup
  - Motivation: `npx skills add` and other npm/git/curl calls failed with SSL cert errors because the OneCLI CA bundle at `/tmp/nanoclaw-onecli/onecli-combined-ca.pem` was not picked up automatically. The new `bootstrap-ssl.sh` configures `GIT_SSL_CAINFO`, `NODE_EXTRA_CA_CERTS`, and `SSL_CERT_FILE` before network operations run.
- fix(container): bootstrap OneCLI placeholder env vars at container startup
  - Motivation: Skills pre-flight checks (`[ -z "$COLOSSEUM_COPILOT_PAT" ]`) failed because secret vars were unset, even though OneCLI proxy injects real values at HTTPS intercept time. The new `onecli-secrets-manifest.sh` exports `VAR=placeholder` for each known secret at startup so checks pass. See `docs/credentials.md` for the full placeholder pattern.
- fix(container): compose OneCLI startup hooks through a shared bootstrap loader
  - Motivation: The placeholder bootstrap and SSL bootstrap both patch container startup. Loading hooks through `bootstrap-env.sh` keeps the fixes merge-order safe so landing one PR does not drop the other startup behavior.

## 2026-03-04

- Synced from: `upstream/main` into `andy-autonomous`
- Version: `1.1.6` -> `1.2.4`

### Bug Fixes

- Upstream worker/runtime reliability fixes landed across container runtime, container runner, IPC auth, DB, scheduler, and queue paths.
- Upstream test coverage expanded for channel registry, sender allowlist, and runtime/dispatch-adjacent flows.

### Features

- Added channel registry architecture (`src/channels/index.ts`, `src/channels/registry.ts`) replacing direct WhatsApp-only channel module wiring.
- Added sender allowlist support (`src/sender-allowlist.ts`) and associated tests.
- Added agent-runner IPC MCP stdio updates in container runner code path.

### Functionality/Behavior

- Legacy WhatsApp-specific files were removed from core (`src/channels/whatsapp.ts` and test), in favor of centralized channel registration.
- Legacy dispatch/event bridge and worker supervisor paths removed, with behavior consolidated into updated runtime/index/queue/IPC contracts.
- Core package/runtime metadata updated to `1.2.4`.

### Docs/Infra

- Container rules markdown files from old runtime paths removed in upstream core.

### Conflict Notes And Local Compatibility Decisions

- Merge conflicts: none.
- Local compatibility overrides during sync: none.
- Sync applied upstream-first with no custom patch reapply failures and no skill reapply failures.
