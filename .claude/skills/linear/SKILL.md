---
name: linear
description: |
  Canonical Linear access via mcp__symphony__linear_graphql.
  Use for all Linear reads, writes, comment edits, and mutations.
  Do NOT use the OAuth plugin (mcp__plugin_linear_linear__*) or curl.
---

# Linear GraphQL

`mcp__symphony__linear_graphql` is the single canonical path for all Linear operations.

## Tool

```
mcp__symphony__linear_graphql(query: "...", variables?: "{...}")
```

- `query`: GraphQL query or mutation string
- `variables`: optional JSON-encoded variables string (e.g. `"{\"id\": \"NAN-33\"}"`)
- Returns `structuredContent` (native JSON) + `content[0].text` (JSON string)

## Rules

- Use `mcp__symphony__linear_graphql` for ALL Linear reads and writes
- Never use `mcp__plugin_linear_linear__*` — it returns full payloads and cannot edit comments
- Never use curl against `api.linear.app` — use this tool instead
- Request only the fields you need — narrow reads save tokens
- One GraphQL operation per tool call

## Related Symphony Tools

For listing ready issues, use the dedicated tool instead of GraphQL:

```
mcp__symphony__symphony_list_ready_issues { "project_key": "nanoclaw" }
```

This is more efficient than writing a GraphQL query for the same purpose.

## Common Queries

### Narrow issue triage (token-efficient)

```graphql
query {
  issues(
    filter: { project: { id: { eq: "PROJECT_ID" } } state: { name: { eq: "Ready" } } }
    first: 50
  ) {
    nodes { identifier title state { name } }
  }
}
```

### Get full issue body (use sparingly)

```graphql
query IssueByKey($id: String!) {
  issue(id: $id) {
    id identifier title description
    state { id name type }
    project { id name }
  }
}
```

Variables: `{"id": "NAN-33"}`

### Team workflow states

```graphql
query {
  issue(id: $id) {
    team { id key states { nodes { id name type } } }
  }
}
```

### Templates

```graphql
query { templates { id name type } }
```

## Common Mutations

### Create comment

```graphql
mutation CreateComment($issueId: String!, $body: String!) {
  commentCreate(input: { issueId: $issueId body: $body }) {
    success
    comment { id url }
  }
}
```

Variables: `{"issueId": "<internal-id>", "body": "## Test Results..."}`

### Edit comment

```graphql
mutation UpdateComment($id: String!, $body: String!) {
  commentUpdate(id: $id, input: { body: $body }) {
    success
    comment { id body }
  }
}
```

### Move issue to state

```graphql
mutation MoveIssue($id: String!, $stateId: String!) {
  issueUpdate(id: $id, input: { stateId: $stateId }) {
    success
    issue { id identifier state { id name } }
  }
}
```

Fetch team states first to get the exact `stateId`.

### Attach GitHub PR

```graphql
mutation AttachPR($issueId: String!, $url: String!, $title: String) {
  attachmentLinkGitHubPR(issueId: $issueId url: $url title: $title linkKind: links) {
    success
    attachment { id title url }
  }
}
```

## Introspection

When the exact field or mutation shape is unclear:

```graphql
query { __type(name: "Mutation") { fields { name } } }
```

```graphql
query { __type(name: "CommentCreateInput") {
  inputFields { name type { kind name ofType { kind name } } }
} }
```

---

## Troubleshooting

### Common Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `401 Unauthorized` | Missing/expired `LINEAR_API_KEY` | Restart MCP with valid key |
| `403 Forbidden` | Team key wrong or no access | Verify team key in Linear URL |
| `Rate limited` | Too many requests | Add delay between calls |
| `Variable type mismatch` | Wrong JSON format in variables | Ensure variables is valid JSON string |

### Debug Steps

1. **Verify token**:

   ```bash
   echo $LINEAR_API_KEY
   ```

2. **Test connectivity**:

   ```graphql
   query { viewer { name } }
   ```

3. **Check team key**:
   GraphQL requires team key (e.g., "NAN"), not team name.

4. **Verify issue ID format**:
   Use internal ID (e.g., "NAN-33") not UUID.

### Restart MCP

If Linear MCP fails completely:

1. Check `.mcp.json` has `mcp__symphony__linear_graphql` configured
2. Restart Claude Code session
3. If still failing: check `LINEAR_API_KEY` in `.env`

### Complex Scenarios

For complex debugging (worktree issues, dispatch failures), see:

- `docs/troubleshooting/SYMPHONY-NIGHTLY-FLOW.md`
- `docs/workflow/control-plane/symphony-operations-runbook.md`
