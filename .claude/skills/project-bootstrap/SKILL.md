---
name: project-bootstrap
description: |
  Bootstrap a project into the Linear + Notion + Symphony + GitHub management model.
  Load this skill before any project onboarding work — whether the user is setting up
  a new repo for NanoClaw, or Andy developer is taking ownership of a new project to manage.
  Covers three modes: nanoclaw-like (NAN team, ingpoc), downstream-product (opencode-worker),
  and andy-project (AND team, openclaw-gurusharan, MCP-driven). Use andy-project mode when
  Andy is asked to manage, own, or bootstrap any new project autonomously.
---

# Project Bootstrap

Bootstrap any repo into the `Linear + Notion + Symphony + GitHub` operating model.
Three modes are supported — pick the one that matches who owns the project.

| Mode | Team | GitHub account | Execution |
|------|------|----------------|-----------|
| `nanoclaw-like` | NAN | ingpoc | Script |
| `downstream-product` | NAN | ingpoc | Script |
| `andy-project` | AND | openclaw-gurusharan | MCP tools |

---

## Modes A & B — `nanoclaw-like` and `downstream-product`

These modes are script-backed. Run from the NanoClaw working directory.

### Commands

```bash
# Inspect current state
npx tsx scripts/workflow/project-bootstrap.ts inspect \
  --repo "<owner/repo|github-url|local-path>" \
  --mode <nanoclaw-like|downstream-product> \
  [--local-path "<path>"]

# Dry-run (confirm plan before applying)
npx tsx scripts/workflow/project-bootstrap.ts dry-run \
  --repo "<owner/repo|github-url|local-path>" \
  --mode <nanoclaw-like|downstream-product> \
  [--local-path "<path>"]

# Apply
npx tsx scripts/workflow/project-bootstrap.ts apply \
  --repo "<owner/repo|github-url|local-path>" \
  --mode <nanoclaw-like|downstream-product> \
  --local-path "<path>"

# Status check
npx tsx scripts/workflow/project-bootstrap.ts status --project-key "<project-key>"
```

### Required env

- `NOTION_PROJECT_REGISTRY_DATABASE_ID`
- `NOTION_KNOWLEDGE_PARENT_PAGE_ID`
- `NOTION_SESSION_CONTEXT_PARENT_PAGE_ID`
- `LINEAR_API_KEY`
- `NANOCLAW_LINEAR_TEAM_KEY`

### Mode defaults

**`nanoclaw-like`**

- allowed backends: `codex`, `claude-code`
- default backend: `claude-code`
- work classes: `nanoclaw-core`, `governance`, `research`

**`downstream-product`**

- allowed backends: `opencode-worker`
- default backend: `opencode-worker`
- work classes: `downstream-project`

### Bundled templates

`templates/CLAUDE.md.tpl`, `AGENTS.md.tpl`, `project-control-plane-contract.md.tpl`, `symphony-mcp.sh.tpl`.
Do not handcraft these in target repos — let the bootstrap tool render them.

### Verification

```bash
npm run symphony:sync-registry
npm run symphony:status
npx tsx scripts/workflow/symphony.ts show-projects
```

---

## Mode C — `andy-project`

Andy developer uses this mode. It is MCP-driven — no script required. Andy executes
each step directly using available MCP and CLI tools.

### Required env

- `NOTION_PROJECT_REGISTRY_DATABASE_ID`
- `NOTION_ANDY_ROOT_PAGE_ID` — Notion page under which all Andy project pages are created
- `LINEAR_API_KEY`
- GitHub CLI authenticated as `openclaw-gurusharan`

### STEP 1 — Gather inputs

Confirm before proceeding:

- **Project name** (required) — becomes the Linear project name and Notion page title
- **GitHub repo** (required) — either an existing URL/`owner/name`, or a new repo name to create under `openclaw-gurusharan`
- **Description** (optional)
- **Work class** — `implementation` | `research` | `governance` (default: `implementation`)

### STEP 2 — Pre-flight

Run all three checks before doing any writes. Fail loud if any fails.

**Linear — resolve AND team at runtime** (never hardcode team ID):

```graphql
{ teams { nodes { id name key } } }
```

Find the team with `key = "AND"`. Record its `id` as `AND_TEAM_ID`.

**GitHub — verify openclaw-gurusharan auth**:

```bash
gh auth status
```

If the active account is not `openclaw-gurusharan`, switch:

```bash
gh auth switch --user openclaw-gurusharan
```

If the account is not logged in at all, stop and ask the user to run `gh auth login` for `openclaw-gurusharan` before proceeding.

**Notion — verify access**:

```
notion_search query="Andy" limit=1
```

Any result (even empty) confirms connectivity. An error means Notion credentials are missing — stop.

### STEP 3 — Linear project

Create the project in the AND team:

```graphql
mutation {
  projectCreate(input: {
    name: "<ProjectName>"
    description: "<description>"
    teamIds: ["<AND_TEAM_ID>"]
  }) {
    success
    project { id name url }
  }
}
```

Record `project.id` as `LINEAR_PROJECT_ID` and `project.url` as `LINEAR_PROJECT_URL`.

### STEP 4 — Linear initial issues

Create three Backlog issues in the AND team. Use `stateId` for Backlog (resolve from
`team.states` if needed — look for `name = "Backlog"`).

```graphql
mutation CreateIssue($input: IssueCreateInput!) {
  issueCreate(input: $input) {
    success
    issue { id identifier title }
  }
}
```

Issues to create (one mutation each):

| Title | Label hint |
|-------|-----------|
| `[Setup] Development environment and tooling` | setup |
| `[Docs] Architecture overview and README` | documentation |
| `[Delivery] First implementation milestone` | feature |

### STEP 5 — Notion root page

Create the project page under `NOTION_ANDY_ROOT_PAGE_ID`:

```
notion_create_page
  parent_page_id: <NOTION_ANDY_ROOT_PAGE_ID>
  title: "<ProjectName> — Andy Project"
  markdown_body: |
    ## Overview
    <one-line project description>

    ## Architecture
    _To be filled in as the project evolves._

    ## Run Summaries
    _Agents append structured run summaries here after each task._

    ## Decisions
    _Key architectural and product decisions logged here._
```

Record the returned `url` as `NOTION_ROOT_URL`.

### STEP 6 — Symphony registry

The Symphony project registry lives in a Notion database (`NOTION_PROJECT_REGISTRY_DATABASE_ID`).
Add a new row with these fields:

| Field | Value |
|-------|-------|
| Name | `<ProjectName>` |
| Project Key | `AND-<slug>` (e.g. `AND-myproject`) |
| Linear Project | `<LINEAR_PROJECT_URL>` |
| Notion Root | `<NOTION_ROOT_URL>` |
| GitHub Repo | `openclaw-gurusharan/<repo-name>` |
| Symphony Enabled | `true` |
| Allowed Backends | `claude-code` |
| Default Backend | `claude-code` |
| Work Classes Supported | `implementation` (or chosen work class) |
| Secret Scope | `andy` |
| Workspace Root | local checkout path |
| Ready Policy | `standard` |

After inserting the row, sync the local registry cache:

```bash
npm run symphony:sync-registry
```

Then verify the project is visible:

```
mcp__symphony__symphony_list_projects enabled_only=false
```

Confirm the new project key appears in the response before continuing.

### STEP 7 — GitHub setup

**Existing repo:**

```bash
gh repo view <url-or-owner/name> --json name,owner,url
```

Verify `owner.login = "openclaw-gurusharan"`. If the repo is under a different owner,
fork it:

```bash
gh repo fork <source-url> --org openclaw-gurusharan --clone=false
```

**New repo:**

```bash
gh repo create openclaw-gurusharan/<repo-name> \
  --private \
  --description "<description>"
```

**Write CLAUDE.md to the repo root** using the template at
`templates/andy-CLAUDE.md.tpl`. Render with the project values and commit:

```bash
git clone git@github.com:openclaw-gurusharan/<repo-name>.git /tmp/<repo-name>
# write CLAUDE.md
cd /tmp/<repo-name>
git add CLAUDE.md
git commit -m "chore: add project control-plane contract"
git push
```

### STEP 8 — Verification checklist

Confirm each item before declaring the bootstrap complete:

- [ ] AND team resolved at runtime (not hardcoded)
- [ ] Linear project visible in AND team with correct name
- [ ] 3 initial Backlog issues created (`[Setup]`, `[Docs]`, `[Delivery]`)
- [ ] Notion root page accessible at `NOTION_ROOT_URL`
- [ ] Symphony registry entry exists and `symphony_list_projects` shows the new key
- [ ] GitHub repo accessible under `openclaw-gurusharan`
- [ ] CLAUDE.md committed to repo root

---

## Fail-Loud Rules (all modes)

- Do not create a fallback local work tracker — Linear is the only task system of record.
- Do not proceed without a verifiable GitHub repo identity.
- Do not proceed without the required Notion parent pages and Linear team key.
- Do not skip the Notion root page — agents need it for context write-back.
- Do not overwrite existing target-repo instruction files silently; only create missing ones.
- If `symphony:sync-registry` fails, surface the error and stop — a registry out of sync means Symphony will silently skip the project.
