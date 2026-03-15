---
name: notion
description: |
  Notion workspace access. Use for searching, creating pages, databases, and tasks.
  MCP-first: use built-in Notion skills, not REST API directly.
---

# Notion Workspace

Notion is used for research storage, documentation, and task tracking in NanoClaw.

## Available Skills

Use these built-in skills for Notion operations:

| Skill | Purpose |
|-------|---------|
| `Notion:search` | Search Notion workspace |
| `Notion:find` | Quick page/database lookup by title |
| `Notion:create-page` | Create new page |
| `Notion:create-database-row` | Add row to database |
| `Notion:database-query` | Query database by name/ID |
| `Notion:create-task` | Create task in tasks database |

## Common Tasks

### Search workspace

Use skill: `Notion:search` with query terms.

### Find page by name

Use skill: `Notion:find` with title keywords.

### Create a page

Use skill: `Notion:create-page` with parent page ID and content.

### Add to database

Use skill: `Notion:create-database-row` with database ID and properties.

### Query database

Use skill: `Notion:database-query` with database name or ID.

---

## Troubleshooting

### Common Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `Not authorized` | No Notion OAuth connection | Run `notion connect` or setup OAuth |
| `Database not found` | Wrong database ID | Use `Notion:find` to locate correct ID |
| `Permission denied` | Page not shared with integration | Share page with NanoClaw integration |

### Debug Steps

1. **Test connectivity**:

   ```
   Notion:search { "query": "test" }
   ```

2. **Find correct database**:

   ```
   Notion:find { "title": "tasks" }
   ```

3. **Check page permissions**: Ensure page is shared with the integration

### Restart Notion

Notion MCP is typically built-in. If skills fail:

1. Restart Claude Code session
2. Check Notion OAuth is connected in settings

---

## NanoClaw Integration

Notion is used for:

- Research article storage (`docs/workflow/`)
- Session documentation
- Task tracking (when not using Linear)

For complex workflows, see:

- `docs/workflow/context-learning-loop.md`
- `docs/workflow/strategy/workflow-optimization-loop.md`
