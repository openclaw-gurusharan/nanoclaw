#!/usr/bin/env -S npx tsx

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import {
  notionCreateMemory,
  notionCreatePage,
  notionGetPage,
  notionQueryMemory,
  notionSearch,
} from '../../src/symphony-notion.js';

const DEFAULT_MEMORY_DATABASE_ID = process.env.NOTION_AGENT_MEMORY_DATABASE_ID || '';

function resultWithJson(summary: string, payload: unknown) {
  return {
    content: [
      {
        type: 'text' as const,
        text: `${summary}\n\n${JSON.stringify(payload, null, 2)}`,
      },
    ],
  };
}

const server = new McpServer({
  name: 'notion',
  version: '1.0.0',
});

server.tool(
  'notion_search',
  'Search the Notion workspace by keyword. Returns [{id, title, url, lastEditedTime}] — lean metadata only, no page content. Use to locate run summaries or project docs before fetching their content.',
  {
    query: z.string().describe('Search keyword or phrase.'),
    limit: z.number().int().min(1).max(20).optional().describe('Max results to return. Defaults to 5.'),
  },
  async (args) => {
    const results = await notionSearch(args.query, args.limit);
    return resultWithJson(`${results.length} Notion page(s) matched "${args.query}".`, results);
  },
);

server.tool(
  'notion_create_page',
  'Create a Notion page under a parent page with a markdown body (converted to blocks, max 100). Returns {id, url}. Use to write run summaries or structured project docs.',
  {
    parent_page_id: z.string().describe('Parent page ID.'),
    title: z.string().describe('Title of the new page.'),
    markdown_body: z.string().describe('Markdown content. Supports # headings, - bullets, paragraphs. Max 100 blocks.'),
  },
  async (args) => {
    const result = await notionCreatePage(args.parent_page_id, args.title, args.markdown_body);
    return resultWithJson(`Created Notion page "${args.title}".`, result);
  },
);

server.tool(
  'notion_get_page',
  'Read a Notion page as a lean summary: title and [{heading, preview(200 chars)}] sections only. Use to orient before creating a sub-page or verifying a run summary exists.',
  {
    page_id: z.string().describe('Notion page ID.'),
  },
  async (args) => {
    const result = await notionGetPage(args.page_id);
    return resultWithJson(`Loaded Notion page "${result.title}".`, result);
  },
);

server.tool(
  'notion_query_memory',
  'Query the agent memory database for prior context. Call at task START to load relevant decisions and constraints. Always filter by type — never do a full dump.',
  {
    project_key: z.string().describe('Project key (e.g. NAN, AND-myproject).'),
    type: z
      .enum(['decision', 'architecture', 'constraint', 'lesson', 'run-summary'])
      .optional()
      .describe('Filter by memory type. Always pass this — do not load all types at once.'),
    limit: z.number().int().min(1).max(10).optional().describe('Max entries to return. Defaults to 5.'),
  },
  async (args) => {
    const databaseId = DEFAULT_MEMORY_DATABASE_ID;
    if (!databaseId) {
      throw new Error('Missing NOTION_AGENT_MEMORY_DATABASE_ID env var.');
    }
    const entries = await notionQueryMemory(databaseId, args.project_key, args.type, args.limit);
    return resultWithJson(
      `${entries.length} memory entry(ies) found for project ${args.project_key}${args.type ? ` (type: ${args.type})` : ''}.`,
      entries,
    );
  },
);

server.tool(
  'notion_create_memory',
  'Write an important finding to the agent memory database. Call at task END only if a decision, constraint, lesson, or architecture note was discovered. Skip if nothing new was learned.',
  {
    project_key: z.string().describe('Project key (e.g. NAN, AND-myproject).'),
    type: z
      .enum(['decision', 'architecture', 'constraint', 'lesson', 'run-summary'])
      .describe('Memory type.'),
    content: z
      .string()
      .max(2000)
      .describe('Concise fact to remember. Max 2000 chars. Focus on what future runs should know.'),
    scope: z
      .enum(['global', 'project', 'agent'])
      .optional()
      .describe('Memory scope. Defaults to project.'),
    memory_id: z
      .string()
      .optional()
      .describe('Optional stable ID. Defaults to <projectKey>-<type>-<timestamp>.'),
  },
  async (args) => {
    const databaseId = DEFAULT_MEMORY_DATABASE_ID;
    if (!databaseId) {
      throw new Error('Missing NOTION_AGENT_MEMORY_DATABASE_ID env var.');
    }
    const memoryId =
      args.memory_id ||
      `${args.project_key}-${args.type}-${Date.now()}`;
    const result = await notionCreateMemory(databaseId, {
      memoryId,
      type: args.type,
      scope: args.scope ?? 'project',
      projectKey: args.project_key,
      content: args.content,
    });
    return resultWithJson(`Memory entry "${memoryId}" created.`, result);
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
