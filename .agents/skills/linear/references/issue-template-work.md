# Symphony Work Issue Template (nanoclaw project)

Use this template when creating or updating work-type issues in the **nanoclaw** project.
Symphony will NOT pick up an issue missing any required section.

> Linear template ID: `8503d706-dd07-4eb2-908e-86d85db7a3e4` ("Claude md management") is a stub — use this template instead for any new work issue.

## Required Sections (ALL must be present and non-placeholder)

```markdown
## Problem Statement

[One paragraph. What needs to change and why. Be specific — vague statements cause Symphony to
 produce low-quality output.]

## Scope

- In scope: [what this task covers]
- Out of scope: [what this task explicitly does NOT touch]

## Acceptance Criteria

- [Specific, verifiable outcome — e.g. "npm run build exits 0"]
- [User-visible behaviour or file change that proves the task is done]
- [Repeat for each criterion]

## Required Checks

[command 1]
[command 2]
[command 3]

<!-- One command per line. All must exit 0 for PASS. -->

## Required Evidence

- [What output proves the check passed — e.g. "build output: 0 errors"]
- [Paste errors if any command fails]

## Blocked If

- [Condition that blocks this task — e.g. "GITHUB_TOKEN not set"]
- [Missing dependency or env var]

## Symphony Routing

- Execution Lane: symphony
- Target Runtime: claude-code
- Work Class: nanoclaw-core
- Target Repo: https://github.com/ingpoc/nanoclaw.git
- Base Branch: main
```

## Field Rules

| Field | Rule |
|-------|------|
| `Target Runtime` | Always `claude-code` for nanoclaw work (needs Linear MCP to post results) |
| `Work Class` | `nanoclaw-core` for core NanoClaw changes; `downstream-project` for Jarvis worker changes |
| `Agent` | Omit unless a specific agent is needed (e.g. `nightly-improvement-researcher`) |
| `Target Repo` | `https://github.com/ingpoc/nanoclaw.git` for nanoclaw; repo URL for downstream |
| `Execution Lane` | Always `symphony` |
| Priority | Must be set (1–4) — `0` (No Priority) causes issues to be skipped by activation logic |

## Common Mistakes That Prevent Pickup

- Missing any of the 7 sections entirely
- Placeholder text remaining (`[...]` patterns) in Required Checks or Symphony Routing
- `Work Class: research` or `Work Class: governance` — these are blocked by Symphony
- `Target Runtime: codex` on an issue that needs to post back to Linear
- No `Target Repo` line in Symphony Routing
