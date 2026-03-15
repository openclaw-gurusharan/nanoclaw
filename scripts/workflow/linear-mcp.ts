#!/usr/bin/env -S npx tsx

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { linearGraphql } from '../../src/symphony-linear.js';

const server = new McpServer({
  name: 'linear',
  version: '1.0.0',
});

server.registerTool(
  'linear_graphql',
  {
    description:
      'Execute a raw Linear GraphQL query or mutation with full field control. Use this for all Linear reads and writes — it returns only the fields you request, keeping token usage minimal. Prefer narrow queries (identifier, title, state { name }) over broad ones. For bulk triage, request only summary fields. For writes, use mutations (issueUpdate, commentCreate, commentUpdate, attachmentLinkGitHubPR).',
    inputSchema: {
      query: z.string().describe('GraphQL query or mutation document string.'),
      variables: z
        .string()
        .optional()
        .describe('Optional JSON-encoded variables object. Example: "{\"id\": \"NAN-33\"}".'),
    },
  },
  async (args) => {
    const variables = args.variables ? (JSON.parse(args.variables) as Record<string, unknown>) : {};
    const data = await linearGraphql<Record<string, unknown>>(args.query, variables);
    return {
      content: [{ type: 'text', text: JSON.stringify(data) }],
      structuredContent: data,
    };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
