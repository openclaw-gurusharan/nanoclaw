# GitHub Access

This lane uses the dedicated OneCLI agent `andy-bot`.

## Authentication

GitHub credentials are selected in the OneCLI dashboard and injected by the
OneCLI gateway at request time. Do not expect a real `GITHUB_TOKEN` or
`GH_TOKEN` value in the environment, and do not write credentials into
`.git-credentials`, remote URLs, shell profiles, or memory files.

Anthropic auth is separate: the host provides Claude OAuth via NanoClaw's local
credential proxy.

Use plain HTTPS GitHub URLs and let the proxy inject the lane-scoped secret:

```bash
git clone https://github.com/openclaw-gurusharan/REPO.git
```

Always set git identity before committing:

```bash
git config --global user.email "openclaw-gurusharan@users.noreply.github.com"
git config --global user.name "Andy (openclaw-gurusharan)"
```

## Workspace

Clone repos into `/workspace/extra/repos/` — persists on host at `~/Documents/remote-claude/active/apps/NanoClawWorkspace`:

```bash
cd /workspace/extra/repos
git clone https://github.com/openclaw-gurusharan/REPO.git
cd REPO
git add -A && git commit -m "message" && git push
```

## Discovering Repos

```bash
# List all repos under the account
gh repo list openclaw-gurusharan --limit 50
```

## Access Scope

- Any public repo on GitHub — clone without auth
- Any private repo or API path allowed by the current `andy-bot` OneCLI secret assignment
- If a GitHub request fails with 401/403, inspect the `andy-bot` agent access in OneCLI instead of hunting for a missing local token
