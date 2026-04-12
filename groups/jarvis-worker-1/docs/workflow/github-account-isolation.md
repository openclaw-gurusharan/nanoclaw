# GitHub Account Isolation & Environment

Canonical reference for Jarvis GitHub auth inside NanoClaw containers.

## Source of Truth

- GitHub credentials are assigned per lane in the OneCLI dashboard.
- Jarvis worker lanes use the OneCLI agent whose identifier matches the worker
  folder (`jarvis-worker-1`, `jarvis-worker-2`, etc.).
- Anthropic auth is separate and remains host-provided through NanoClaw's local
  credential proxy.

## What The Container Gets

- `HTTPS_PROXY` / `HTTP_PROXY` from OneCLI so outbound GitHub traffic passes
  through the gateway
- `GH_TOKEN=placeholder` and `GITHUB_TOKEN=placeholder` only to make GitHub
  clients emit authenticated requests
- no real GitHub token in the environment, workspace files, or shell profiles

The gateway injects the real lane-scoped secret at request time.

## How To Use GitHub

Use plain HTTPS GitHub URLs. Do not embed tokens in remotes, URLs, or
`.git-credentials`.

```bash
cd /workspace/group/workspace
git clone https://github.com/openclaw-gurusharan/REPO.git
```

For API and PR operations:

```bash
gh repo list openclaw-gurusharan --limit 50
gh pr create ...
```

## Troubleshooting

| Problem | Action |
|---------|--------|
| `git` or `gh` returns 401/403 | verify the worker's OneCLI agent has the right secret assignment |
| request hits the wrong account scope | check which secret is assigned to this worker lane in OneCLI |
| Anthropic auth fails | inspect the host-side NanoClaw credential proxy, not OneCLI |

## Rules

- Never hardcode or paste raw GitHub tokens into commands or files.
- Never rely on local keychains, direnv, or `gh auth login` state inside the container.
- Treat OneCLI as the owner of non-Anthropic lane credentials.
