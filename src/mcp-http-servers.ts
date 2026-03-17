/**
 * Host-side HTTP MCP servers for Notion and Linear.
 *
 * Started during NanoClaw boot so all container sessions (andy-developer,
 * jarvis workers, main lane) can reach them immediately via
 * host.docker.internal:<port>/mcp — no secrets enter any container.
 *
 * Mirrors the credential-proxy pattern: one call at startup, servers
 * stay alive for the lifetime of the NanoClaw process.
 */
import { createServer, Server } from 'http';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';

import { readEnvFile } from './env.js';
import { logger } from './logger.js';
import {
  notionCreateMemory,
  notionCreatePage,
  notionGetPage,
  notionQueryMemory,
  notionSearch,
} from './symphony-notion.js';
import { linearGraphql } from './symphony-linear.js';

function startServer(
  port: number,
  label: string,
  registerTools: (server: McpServer) => void,
): Promise<Server> {
  return new Promise((resolve, reject) => {
    const httpServer = createServer(async (req, res) => {
      if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', service: label, port }));
        return;
      }

      if (!req.url?.startsWith('/mcp')) {
        res.writeHead(404);
        res.end('Not Found');
        return;
      }

      const server = new McpServer({ name: label, version: '1.0.0' });
      registerTools(server);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });
      try {
        await server.connect(transport);
        await transport.handleRequest(req, res);
      } catch (err) {
        logger.error({ err, label }, 'MCP HTTP request error');
        if (!res.headersSent) {
          res.writeHead(500);
          res.end('Internal Server Error');
        }
      }
    });

    httpServer.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        logger.warn(
          { port, label },
          `MCP HTTP server port in use — skipping (another instance may be running)`,
        );
        resolve(httpServer);
      } else {
        reject(err);
      }
    });

    httpServer.listen(port, '0.0.0.0', () => {
      logger.info({ port, label }, `MCP HTTP server listening`);
      resolve(httpServer);
    });
  });
}

function registerNotionTools(server: McpServer): void {
  const databaseId =
    process.env.NOTION_AGENT_MEMORY_DATABASE_ID ||
    readEnvFile(['NOTION_AGENT_MEMORY_DATABASE_ID'])
      .NOTION_AGENT_MEMORY_DATABASE_ID ||
    '';

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

  server.tool(
    'notion_search',
    'Search the Notion workspace by keyword. Returns [{id, title, url, lastEditedTime}] — lean metadata only, no page content.',
    {
      query: z.string().describe('Search keyword or phrase.'),
      limit: z
        .number()
        .int()
        .min(1)
        .max(20)
        .optional()
        .describe('Max results. Defaults to 5.'),
    },
    async (args) => {
      const results = await notionSearch(args.query, args.limit);
      return resultWithJson(
        `${results.length} Notion page(s) matched "${args.query}".`,
        results,
      );
    },
  );

  server.tool(
    'notion_create_page',
    'Create a Notion page under a parent page with a markdown body (max 100 blocks). Returns {id, url}.',
    {
      parent_page_id: z.string().describe('Parent page ID.'),
      title: z.string().describe('Title of the new page.'),
      markdown_body: z.string().describe('Markdown content. Max 100 blocks.'),
    },
    async (args) => {
      const result = await notionCreatePage(
        args.parent_page_id,
        args.title,
        args.markdown_body,
      );
      return resultWithJson(`Created Notion page "${args.title}".`, result);
    },
  );

  server.tool(
    'notion_get_page',
    'Read a Notion page as a lean summary: title and [{heading, preview(200 chars)}] sections only.',
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
    'Query the agent memory database for prior context. Always filter by type.',
    {
      project_key: z
        .string()
        .describe('Project key (e.g. NAN, AND-myproject).'),
      type: z
        .enum([
          'decision',
          'architecture',
          'constraint',
          'lesson',
          'run-summary',
        ])
        .optional()
        .describe('Filter by memory type.'),
      limit: z
        .number()
        .int()
        .min(1)
        .max(10)
        .optional()
        .describe('Max entries. Defaults to 5.'),
    },
    async (args) => {
      if (!databaseId)
        throw new Error('Missing NOTION_AGENT_MEMORY_DATABASE_ID env var.');
      const entries = await notionQueryMemory(
        databaseId,
        args.project_key,
        args.type,
        args.limit,
      );
      return resultWithJson(
        `${entries.length} memory entry(ies) for project ${args.project_key}${args.type ? ` (type: ${args.type})` : ''}.`,
        entries,
      );
    },
  );

  server.tool(
    'notion_create_memory',
    'Write a finding to the agent memory database. Call at task END only if something new was learned.',
    {
      project_key: z
        .string()
        .describe('Project key (e.g. NAN, AND-myproject).'),
      type: z
        .enum([
          'decision',
          'architecture',
          'constraint',
          'lesson',
          'run-summary',
        ])
        .describe('Memory type.'),
      content: z.string().max(2000).describe('Concise fact. Max 2000 chars.'),
      scope: z
        .enum(['global', 'project', 'agent'])
        .optional()
        .describe('Scope. Defaults to project.'),
      memory_id: z.string().optional().describe('Optional stable ID.'),
    },
    async (args) => {
      if (!databaseId)
        throw new Error('Missing NOTION_AGENT_MEMORY_DATABASE_ID env var.');
      const memoryId =
        args.memory_id || `${args.project_key}-${args.type}-${Date.now()}`;
      const result = await notionCreateMemory(databaseId, {
        memoryId,
        type: args.type,
        scope: args.scope ?? 'project',
        projectKey: args.project_key,
        content: args.content,
      });
      return {
        content: [
          {
            type: 'text' as const,
            text: `Memory entry "${memoryId}" created.\n\n${JSON.stringify(result, null, 2)}`,
          },
        ],
      };
    },
  );
}

function registerLinearTools(server: McpServer): void {
  server.registerTool(
    'linear_graphql',
    {
      description:
        'Execute a raw Linear GraphQL query or mutation. Returns only the fields you request — keep queries narrow.',
      inputSchema: {
        query: z
          .string()
          .describe('GraphQL query or mutation document string.'),
        variables: z
          .string()
          .optional()
          .describe('Optional JSON-encoded variables object.'),
      },
    },
    async (args) => {
      const variables = args.variables
        ? (JSON.parse(args.variables) as Record<string, unknown>)
        : {};
      const data = await linearGraphql<Record<string, unknown>>(
        args.query,
        variables,
      );
      return {
        content: [{ type: 'text', text: JSON.stringify(data) }],
        structuredContent: data,
      };
    },
  );
}

export async function startMcpHttpServers(
  notionPort: number,
  linearPort: number,
): Promise<{ notionServer: Server; linearServer: Server }> {
  const [notionServer, linearServer] = await Promise.all([
    startServer(notionPort, 'notion-mcp-http', registerNotionTools),
    startServer(linearPort, 'linear-mcp-http', registerLinearTools),
  ]);
  return { notionServer, linearServer };
}
