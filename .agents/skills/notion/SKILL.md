---
name: notion
description: |
  NanoClaw Notion workspace access — searching, reading, and writing pages for
  agent context and run summaries. Load this skill when any agent is starting a
  task in a managed project (to inject context), completing a task (to write back
  a run summary), or performing any read/write operation against the NanoClaw
  Notion workspace. Also load when setting up agent context before task execution,
  looking up project docs, or logging decisions and architecture notes.
---

# Notion Workspace

Notion is the long-term memory and context layer for NanoClaw and Andy's projects.
Agents read from Notion before tasks (context injection) and write to Notion after tasks
(run summaries, decisions). Linear owns task state — Notion owns knowledge.

## Tool Priority

Always prefer Notion MCP tools — they return only what you need, keeping token usage
minimal. Fall back to Notion plugin skills only when Notion MCP is unavailable or for
database row operations not covered by the MCP.

| Tool | Returns | Use for |
|------|---------|---------|
| `mcp__notion__notion_search` | `[{id, title, url, lastEditedTime}]` | Locate pages by keyword |
| `mcp__notion__notion_get_page` | `{title, sections:[{heading, preview(200)}]}` | Read lean page summary |
| `mcp__notion__notion_create_page` | `{id, url}` | Write run summaries, decisions |
| `mcp__notion__notion_query_memory` | `[{memoryId, type, scope, content, createdAt}]` | Load prior decisions/constraints at task start |
| `mcp__notion__notion_create_memory` | `{id, url}` | Write important findings after task completion |
| `Notion:create-database-row` | Row result | Adding rows to Notion databases (fallback only) |
| `Notion:database-query` | Database rows | Querying databases by name/ID (fallback only) |

## Agent Memory Database

Structured Notion database for typed, filterable agent memories. Requires `NOTION_AGENT_MEMORY_DATABASE_ID` env var.

| Property | Type | Values |
|----------|------|--------|
| MemoryID | title | `<projectKey>-<type>-<slug>` |
| Type | select | `decision`, `architecture`, `constraint`, `lesson`, `run-summary` |
| Scope | select | `global`, `project`, `agent` |
| ProjectKey | rich_text | e.g. `NAN`, `AND-myproject` |
| Content | rich_text | max 2000 chars |
| CreatedAt | date | ISO timestamp |

**Setup (one-time):** Call `notionCreateMemoryDatabase(NOTION_ANDY_ROOT_PAGE_ID)` or run:

```bash
node --env-file=.env --import node_modules/tsx/dist/loader.mjs \
  -e "import { notionCreateMemoryDatabase } from './src/symphony-notion.js'; \
      const r = await notionCreateMemoryDatabase(process.env.NOTION_ANDY_ROOT_PAGE_ID); \
      console.log('Add to .env:', 'NOTION_AGENT_MEMORY_DATABASE_ID=' + r.id);"
```

---

## Workspace Structure

| Page | ID | Purpose |
|------|----|---------|
| NanoClaw (root) | `32027fc6-f5d3-81ad-8bf2-cba04c1a9622` | Workspace root |
| NanoClaw Control Plane | `32027fc6-f5d3-80a9-92e0-f4b751bec680` | Symphony registry parent |
| Andy — Projects | `32427fc6-f5d3-81a8-8ece-f2cb032b22e2` | Andy project pages |
| [Nightly] NanoClaw Upstream Sync | `32027fc6-f5d3-817a-8117-e69bedacf861` | Nightly improvement logs |

Env vars: `NOTION_PROJECT_REGISTRY_DATABASE_ID`, `NOTION_ANDY_ROOT_PAGE_ID`

---

## Agent Patterns

### 1. Context Injection — Before Starting a Task

Agents start cold without this. Loading project context up-front prevents repeated
mistakes and aligns execution with prior decisions.

```
1. notion_search  query="<ProjectName>"  limit=3
2. notion_get_page  page_id=<project root id>
3. Read only sections relevant to current task — skip unrelated headings
```

The lean `notion_get_page` response (headings + 200-char previews) is enough to orient
without flooding context.

### 2. Write-Back Contract — After Every Completed Task

Agents that don't write summaries leave no trace. Future runs repeat mistakes and
can't build on prior work.

**Dedup first** — avoid duplicate summaries:

```
notion_search  query="RUN <IssueIdentifier>"  limit=1
```

If a page already exists for this run, skip creation.

**Create the run summary page:**

```
notion_create_page
  parent_page_id: <project root page id>
  title: "[RUN] <IssueIdentifier> — <short description> (YYYY-MM-DD)"
  markdown_body: |
    ## Summary
    What was accomplished.

    ## What Changed
    - Files or systems modified

    ## Decisions
    Key choices made and why.

    ## Next Steps
    What should happen next.
```

### 3. Memory Tiers

| Tier | Title pattern | When to write |
|------|---------------|---------------|
| Run summaries | `[RUN] AND-42 — fix auth (2026-03-15)` | After every completed task |
| Decisions | Sub-page: `Decisions — <ProjectName>` | Architectural or product choices |
| Architecture | Sub-page: `Architecture — <ProjectName>` | Major structural changes only |

---

## Anti-Patterns

**Notion ≠ task tracker** — create issues in Linear (NAN or AND team). Notion tracks
knowledge; Linear tracks work.

**Never overwrite existing pages** — always create new or append. Overwriting silently
drops images, links, and formatted content.

**Never load full page content** — `notion_get_page` returns headings + 200-char previews
by design. That's sufficient context.

**Never skip write-back** — even a one-paragraph summary is better than nothing and costs
very little.

---

## Troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| MCP tool not found | Symphony MCP not connected | Restart session; MCP wires at startup |
| `Not authorized` | Notion token missing | Check `NOTION_TOKEN` in `.env` |
| `Object not found` | Wrong page ID | Use `notion_search` to locate correct ID |
| Empty search results | Page not shared with integration | Share page with NanoClaw integration in Notion |
