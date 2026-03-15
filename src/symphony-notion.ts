const NOTION_API_URL = process.env.NOTION_API_URL || 'https://api.notion.com/v1';
const NOTION_VERSION = process.env.NOTION_VERSION || '2022-06-28';

function requireNotionToken(): string {
  const token = process.env.NOTION_TOKEN || process.env.NOTION_API_KEY || '';
  if (!token) throw new Error('Missing NOTION_TOKEN or NOTION_API_KEY.');
  return token;
}

export async function notionRequest<T>(
  method: 'GET' | 'POST' | 'PATCH',
  route: string,
  body?: unknown,
): Promise<T> {
  const response = await fetch(`${NOTION_API_URL}${route}`, {
    method,
    headers: {
      Authorization: `Bearer ${requireNotionToken()}`,
      'Content-Type': 'application/json',
      'Notion-Version': NOTION_VERSION,
      'User-Agent': 'nanoclaw-symphony',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = (await response.json()) as T & { message?: string };
  if (!response.ok) {
    throw new Error(
      `Notion API ${method} ${route} failed: ${response.status} ${(payload as { message?: string }).message ?? ''}`,
    );
  }
  return payload;
}

// --- Search ---

export type NotionSearchResult = {
  id: string;
  title: string;
  url: string;
  lastEditedTime: string;
};

export async function notionSearch(
  query: string,
  limit = 5,
): Promise<NotionSearchResult[]> {
  const data = await notionRequest<{
    results: Array<{
      id: string;
      url: string;
      last_edited_time: string;
      properties?: Record<string, { type: string; title?: Array<{ plain_text: string }> }>;
      title?: Array<{ plain_text: string }>;
    }>;
  }>('POST', '/search', {
    query,
    filter: { property: 'object', value: 'page' },
    page_size: limit,
  });

  return data.results.map((page) => {
    // Pages returned by search have title in properties.title or top-level title
    const titleArr =
      page.properties?.title?.title ??
      page.properties?.Name?.title ??
      page.title ??
      [];
    const title = titleArr.map((t) => t.plain_text).join('') || '(untitled)';
    return {
      id: page.id,
      title,
      url: page.url,
      lastEditedTime: page.last_edited_time,
    };
  });
}

// --- Create page ---

type NotionBlock =
  | { object: 'block'; type: 'heading_1'; heading_1: { rich_text: Array<{ type: 'text'; text: { content: string } }> } }
  | { object: 'block'; type: 'heading_2'; heading_2: { rich_text: Array<{ type: 'text'; text: { content: string } }> } }
  | { object: 'block'; type: 'heading_3'; heading_3: { rich_text: Array<{ type: 'text'; text: { content: string } }> } }
  | { object: 'block'; type: 'bulleted_list_item'; bulleted_list_item: { rich_text: Array<{ type: 'text'; text: { content: string } }> } }
  | { object: 'block'; type: 'paragraph'; paragraph: { rich_text: Array<{ type: 'text'; text: { content: string } }> } };

function rt(content: string) {
  return [{ type: 'text' as const, text: { content } }];
}

function markdownToBlocks(markdown: string): NotionBlock[] {
  const blocks: NotionBlock[] = [];
  for (const line of markdown.split('\n')) {
    if (line.startsWith('### ')) {
      blocks.push({ object: 'block', type: 'heading_3', heading_3: { rich_text: rt(line.slice(4)) } });
    } else if (line.startsWith('## ')) {
      blocks.push({ object: 'block', type: 'heading_2', heading_2: { rich_text: rt(line.slice(3)) } });
    } else if (line.startsWith('# ')) {
      blocks.push({ object: 'block', type: 'heading_1', heading_1: { rich_text: rt(line.slice(2)) } });
    } else if (line.startsWith('- ') || line.startsWith('* ')) {
      blocks.push({ object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: rt(line.slice(2)) } });
    } else {
      blocks.push({ object: 'block', type: 'paragraph', paragraph: { rich_text: rt(line) } });
    }
  }
  // Notion limit: 100 blocks per request
  return blocks.slice(0, 100);
}

export async function notionCreatePage(
  parentPageId: string,
  title: string,
  markdownBody: string,
): Promise<{ id: string; url: string }> {
  const data = await notionRequest<{ id: string; url: string }>('POST', '/pages', {
    parent: { type: 'page_id', page_id: parentPageId },
    properties: {
      title: { title: [{ type: 'text', text: { content: title } }] },
    },
    children: markdownToBlocks(markdownBody),
  });
  return { id: data.id, url: data.url };
}

// --- Agent Memory ---

export type MemoryType = 'decision' | 'architecture' | 'constraint' | 'lesson' | 'run-summary';
export type MemoryScope = 'global' | 'project' | 'agent';

export type MemoryEntry = {
  memoryId: string;
  type: MemoryType;
  scope: MemoryScope;
  projectKey: string;
  content: string;
  createdAt: string;
};

export async function notionQueryMemory(
  databaseId: string,
  projectKey: string,
  type?: MemoryType,
  limit = 5,
): Promise<MemoryEntry[]> {
  const filters: unknown[] = [
    {
      property: 'ProjectKey',
      rich_text: { equals: projectKey },
    },
  ];
  if (type) {
    filters.push({ property: 'Type', select: { equals: type } });
  }
  const body: Record<string, unknown> = {
    filter: filters.length === 1 ? filters[0] : { and: filters },
    sorts: [{ property: 'CreatedAt', direction: 'descending' }],
    page_size: Math.min(limit, 10),
  };
  const data = await notionRequest<{
    results: Array<{
      id: string;
      properties: {
        MemoryID?: { title: Array<{ plain_text: string }> };
        Type?: { select: { name: string } | null };
        Scope?: { select: { name: string } | null };
        ProjectKey?: { rich_text: Array<{ plain_text: string }> };
        Content?: { rich_text: Array<{ plain_text: string }> };
        CreatedAt?: { date: { start: string } | null };
      };
    }>;
  }>('POST', `/databases/${databaseId}/query`, body);

  return data.results.map((row) => ({
    memoryId: (row.properties.MemoryID?.title ?? []).map((t) => t.plain_text).join('') || row.id,
    type: (row.properties.Type?.select?.name ?? 'decision') as MemoryType,
    scope: (row.properties.Scope?.select?.name ?? 'project') as MemoryScope,
    projectKey: (row.properties.ProjectKey?.rich_text ?? []).map((t) => t.plain_text).join(''),
    content: (row.properties.Content?.rich_text ?? []).map((t) => t.plain_text).join(''),
    createdAt: row.properties.CreatedAt?.date?.start ?? '',
  }));
}

export async function notionCreateMemory(
  databaseId: string,
  entry: { memoryId: string; type: MemoryType; scope: MemoryScope; projectKey: string; content: string },
): Promise<{ id: string; url: string }> {
  const data = await notionRequest<{ id: string; url: string }>('POST', '/pages', {
    parent: { type: 'database_id', database_id: databaseId },
    properties: {
      MemoryID: { title: [{ type: 'text', text: { content: entry.memoryId } }] },
      Type: { select: { name: entry.type } },
      Scope: { select: { name: entry.scope } },
      ProjectKey: { rich_text: [{ type: 'text', text: { content: entry.projectKey } }] },
      Content: { rich_text: [{ type: 'text', text: { content: entry.content.slice(0, 2000) } }] },
      CreatedAt: { date: { start: new Date().toISOString() } },
    },
  });
  return { id: data.id, url: data.url };
}

export async function notionCreateMemoryDatabase(
  parentPageId: string,
): Promise<{ id: string; url: string }> {
  const data = await notionRequest<{ id: string; url: string }>('POST', '/databases', {
    parent: { type: 'page_id', page_id: parentPageId },
    title: [{ type: 'text', text: { content: 'Agent Memory' } }],
    properties: {
      MemoryID: { title: {} },
      Type: {
        select: {
          options: [
            { name: 'decision', color: 'blue' },
            { name: 'architecture', color: 'purple' },
            { name: 'constraint', color: 'red' },
            { name: 'lesson', color: 'yellow' },
            { name: 'run-summary', color: 'gray' },
          ],
        },
      },
      Scope: {
        select: {
          options: [
            { name: 'global', color: 'green' },
            { name: 'project', color: 'blue' },
            { name: 'agent', color: 'orange' },
          ],
        },
      },
      ProjectKey: { rich_text: {} },
      Content: { rich_text: {} },
      CreatedAt: { date: {} },
    },
  });
  return { id: data.id, url: data.url };
}

// --- Get page content (lean) ---

export type NotionPageContent = {
  id: string;
  url: string;
  title: string;
  sections: Array<{ heading: string; preview: string }>;
};

export async function notionGetPage(pageId: string): Promise<NotionPageContent> {
  const [page, blocks] = await Promise.all([
    notionRequest<{
      id: string;
      url: string;
      properties?: Record<string, { type: string; title?: Array<{ plain_text: string }> }>;
    }>('GET', `/pages/${pageId}`),
    notionRequest<{
      results: Array<{
        type: string;
        [key: string]: unknown;
      }>;
    }>('GET', `/blocks/${pageId}/children?page_size=50`),
  ]);

  const titleArr = page.properties?.title?.title ?? page.properties?.Name?.title ?? [];
  const title = titleArr.map((t) => t.plain_text).join('') || '(untitled)';

  // Extract headings + first 200 chars of following paragraphs
  const sections: Array<{ heading: string; preview: string }> = [];
  let currentHeading = '';
  let currentText = '';

  for (const block of blocks.results) {
    const isHeading = block.type === 'heading_1' || block.type === 'heading_2' || block.type === 'heading_3';
    const isParagraph = block.type === 'paragraph' || block.type === 'bulleted_list_item';

    if (isHeading) {
      if (currentHeading) sections.push({ heading: currentHeading, preview: currentText.slice(0, 200) });
      const richText = (block[block.type] as { rich_text?: Array<{ plain_text: string }> })?.rich_text ?? [];
      currentHeading = richText.map((t) => t.plain_text).join('');
      currentText = '';
    } else if (isParagraph && currentText.length < 200) {
      const richText = (block[block.type] as { rich_text?: Array<{ plain_text: string }> })?.rich_text ?? [];
      currentText += richText.map((t) => t.plain_text).join('') + ' ';
    }
  }
  if (currentHeading) sections.push({ heading: currentHeading, preview: currentText.slice(0, 200) });

  return { id: page.id, url: page.url, title, sections };
}
