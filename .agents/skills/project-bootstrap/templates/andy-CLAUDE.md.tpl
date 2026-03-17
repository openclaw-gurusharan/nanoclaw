# {{PROJECT_DISPLAY_NAME}}

Managed by Andy developer through the `AND` Linear team.

## Control Plane

- `Linear` owns task state: {{LINEAR_PROJECT_URL}}
- `Notion` owns shared context: {{NOTION_ROOT_URL}}
- `GitHub` owns code delivery: `openclaw-gurusharan/{{GITHUB_REPO}}`
- `Symphony` orchestrates execution under project key `{{PROJECT_KEY}}`

## Working Contract

1. All committed work lives in Linear (AND team) — not in local files or ad hoc notes.
2. Architecture decisions and run summaries go to Notion at `{{NOTION_ROOT_URL}}`.
3. Symphony dispatches only `Ready` issues — move to Ready only when the issue is fully specified.
4. After each run, write a structured summary to the Notion `Run Summaries` section.

## Project Identity

- `Project Key`: `{{PROJECT_KEY}}`
- `Work Class`: `{{PROJECT_MODE}}`
- `GitHub Account`: `openclaw-gurusharan`
- `Linear Team`: `AND` (andyworkspace)

## Andy Agent Instructions

- Read Notion context at `{{NOTION_ROOT_URL}}` before starting any task.
- Write a run summary to Notion after every completed task using `notion_create_page`.
- Create new Linear issues for work discovered during execution — do not scope-creep the current issue.
- Use `gh` CLI authenticated as `openclaw-gurusharan` for all GitHub operations.
