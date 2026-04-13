# Credentials — OneCLI Placeholder Pattern

All secrets in NanoClaw agent containers are provided by the **OneCLI Agent Vault** via HTTPS proxy interception. Raw credentials are **never** stored in container images, environment files, or source code.

## How It Works

1. `container/onecli-secrets-manifest.sh` is sourced at container startup (via `entrypoint.sh`).
2. For each secret name in the manifest, if the variable is not already set, it exports `VAR=placeholder`.
3. The OneCLI HTTPS intercept proxy detects outgoing requests and replaces the `placeholder` value with the real credential in the `Authorization` header (or equivalent) at the wire level.
4. Skills, tools, and SDKs never see or store the real credential — only the proxy does.

## Why Placeholder?

Skill pre-flight checks often guard against missing credentials:

```bash
[ -z "$COLOSSEUM_COPILOT_PAT" ] && echo "Missing PAT" && exit 1
```

Without the placeholder bootstrap, these checks would fail even though the proxy would successfully inject the real token at request time. Setting `VAR=placeholder` satisfies the non-empty check while the proxy handles the real injection.

## Known Secret Names (Manifest)

| Variable | Purpose |
|----------|---------|
| `COLOSSEUM_COPILOT_PAT` | Colosseum Copilot GitHub PAT for skills engine |
| `GITHUB_TOKEN` | GitHub API access for worker lanes |
| `GH_TOKEN` | GitHub CLI authentication |
| `ANTHROPIC_API_KEY` | Claude API access |
| `AGENTMAIL_API_KEY` | AgentMail inbox API for OTP flows |
| `OPENAI_API_KEY` | OpenAI API (fallback LLM) |
| `LINEAR_API_KEY` | Linear project management |
| `NOTION_API_KEY` | Notion agent memory |
| `SLACK_BOT_TOKEN` | Slack channel integration |
| `TELEGRAM_BOT_TOKEN` | Telegram bot integration |
| `DISCORD_BOT_TOKEN` | Discord bot integration |

## Adding a New Secret

1. Add the variable name to `ONECLI_SECRETS` in `container/onecli-secrets-manifest.sh`.
2. Add a row to the table above with purpose.
3. Add the corresponding mapping in the OneCLI vault configuration (outside this repo — contact the platform team).
4. Never put real credentials in any file committed to this repository.

## Security Invariant

> **The `placeholder` string must never reach a real API endpoint without the proxy intercepting.**
> If the proxy is not active, requests will fail authentication — this is the correct safe failure mode.
