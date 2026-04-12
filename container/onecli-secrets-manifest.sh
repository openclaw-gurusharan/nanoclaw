#!/bin/bash
# onecli-secrets-manifest.sh — OneCLI placeholder bootstrap
#
# For each secret name that the OneCLI Agent Vault maps, export VAR=placeholder
# if the variable is not already set. The OneCLI HTTPS intercept proxy replaces
# "placeholder" with the real credential value at request time — never stored here.
#
# Skill pre-flight checks (e.g. `[ -z "$COLOSSEUM_COPILOT_PAT" ]`) pass because
# the variable is non-empty.  The proxy then injects the real token on the wire.
#
# To add a new secret: append the name to ONECLI_SECRETS below, document it in
# docs/credentials.md, and add the mapping in the OneCLI vault config.
#
# Architecture: raw credentials are NEVER stored in this file or any container image.

ONECLI_SECRETS=(
  COLOSSEUM_COPILOT_PAT
  GITHUB_TOKEN
  GH_TOKEN
  ANTHROPIC_API_KEY
  AGENTMAIL_API_KEY
  OPENAI_API_KEY
  LINEAR_API_KEY
  NOTION_API_KEY
  SLACK_BOT_TOKEN
  TELEGRAM_BOT_TOKEN
  DISCORD_BOT_TOKEN
)

for secret in "${ONECLI_SECRETS[@]}"; do
  if [ -z "${!secret:-}" ]; then
    export "${secret}=placeholder"
    echo "[onecli-secrets] ${secret} not set — exported as placeholder (proxy will inject real value)" >&2
  fi
done
