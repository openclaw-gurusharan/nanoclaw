# GitHub Quick Reference (Container)

GitHub auth comes from the lane's OneCLI agent, not from a raw token stored in
the workspace. Use plain HTTPS GitHub URLs and let the gateway inject the
credential for this worker lane.

```bash
# Clone a repo into your workspace
cd /workspace/group/workspace
git clone https://github.com/openclaw-gurusharan/REPO.git

# List repos
gh repo list openclaw-gurusharan --limit 50
```

For push/PR auth details and account isolation rules → read
`/workspace/group/docs/workflow/github-account-isolation.md`
