import { execFileSync } from 'node:child_process';

import {
  getAndyRequestById,
  getAndyRequestByWorkerRun,
  getWorkerRun,
  getWorkerRunProgress,
  hasGitHubDeliveryEvent,
  recordGitHubDeliveryEvent,
  setAndyRequestGitHubIssueLink,
  setAndyRequestGitHubProjectLink,
  type AndyRequestRecord,
} from '../../db.js';
import { logger } from '../../logger.js';

const DELIVERY_REPO_OWNER =
  process.env.NANOCLAW_DELIVERY_REPO_OWNER || 'ingpoc';
const DELIVERY_REPO_NAME =
  process.env.NANOCLAW_DELIVERY_REPO_NAME || 'nanoclaw';
const DELIVERY_PROJECT_OWNER =
  process.env.NANOCLAW_DELIVERY_PROJECT_OWNER ||
  process.env.PROJECT_OWNER ||
  'openclaw-gurusharan';
const DELIVERY_PROJECT_NUMBER = Number.parseInt(
  process.env.NANOCLAW_DELIVERY_PROJECT_NUMBER ||
    process.env.DELIVERY_PROJECT_NUMBER ||
    '2',
  10,
);

const GITHUB_API_VERSION = '2022-11-28';
const STATUS_FIELD_NAMES = ['Workflow Status', 'Status'];
const DELIVERY_BOARD_KEY = 'delivery';
const PROJECT_CACHE_TTL_MS = 60_000;
const PROGRESS_SYNC_THROTTLE_MS = 3_000;

type DeliveryRun = Exclude<ReturnType<typeof getWorkerRun>, undefined>;

export interface DeliveryProjectField {
  id: string;
  name: string;
  type: 'single_select' | 'text' | 'unknown';
  options?: Map<string, string>;
}

export interface DeliveryProject {
  id: string;
  title: string;
  fields: Map<string, DeliveryProjectField>;
}

export interface DeliveryIssueInfo {
  nodeId: string;
  number: number;
  url: string;
  projectItemId: string | null;
}

export interface DeliverySyncClient {
  ensureIssue(request: AndyRequestRecord): Promise<DeliveryIssueInfo>;
  ensureProjectItem(
    request: AndyRequestRecord,
    issue: DeliveryIssueInfo,
  ): Promise<string>;
  updateFields(itemId: string, updates: Record<string, string>): Promise<void>;
  postIssueComment(issueNumber: number, body: string): Promise<string | null>;
}

let projectCache:
  | {
      project: DeliveryProject;
      cachedAt: number;
    }
  | undefined;

const pendingSyncReasons = new Map<string, string>();
const lastProgressSyncAt = new Map<string, number>();
let syncDrainPromise: Promise<void> | null = null;
let resolvedGitHubToken: string | undefined;

function resolveGitHubToken(): string {
  if (resolvedGitHubToken !== undefined) {
    return resolvedGitHubToken;
  }

  resolvedGitHubToken =
    process.env.NANOCLAW_GITHUB_DELIVERY_TOKEN ||
    process.env.ADD_TO_PROJECT_PAT ||
    process.env.GITHUB_TOKEN ||
    process.env.GH_TOKEN ||
    '';

  if (resolvedGitHubToken) {
    return resolvedGitHubToken;
  }

  if (process.env.VITEST === 'true') {
    return '';
  }

  try {
    resolvedGitHubToken = execFileSync('gh', ['auth', 'token'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    resolvedGitHubToken = '';
  }

  return resolvedGitHubToken;
}

function isDeliverySyncConfigured(): boolean {
  return Boolean(
    resolveGitHubToken() &&
    DELIVERY_PROJECT_OWNER &&
    DELIVERY_REPO_OWNER &&
    DELIVERY_REPO_NAME &&
    Number.isFinite(DELIVERY_PROJECT_NUMBER),
  );
}

function truncateLine(value: string, limit: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

export function buildDeliveryIssueTitle(prompt: string): string {
  const summary = truncateLine(prompt, 72) || 'Tracked delivery request';
  return `[Delivery] ${summary}`;
}

export function extractReferencedIssueNumber(prompt: string): number | null {
  const match = prompt.match(/(?:issue\s+)?#(\d+)\b/i);
  if (!match?.[1]) return null;
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export function buildDeliveryIssueBody(request: AndyRequestRecord): string {
  return [
    '<!-- andy_delivery_request -->',
    `<!-- andy_request_id: ${request.request_id} -->`,
    `<!-- execution_board: Andy/Jarvis Delivery -->`,
    '',
    '### Problem Statement',
    request.user_prompt.trim(),
    '',
    '### Work Type',
    'Feature',
    '',
    '### Execution Board',
    'Andy/Jarvis Delivery',
    '',
    '### Scope',
    [
      'In scope: deliver the user-requested outcome through the Andy/Jarvis execution loop.',
      'Out of scope: unrelated NanoClaw platform changes unless split into a linked platform issue.',
    ].join('\n'),
    '',
    '### Acceptance Criteria',
    [
      '- [ ] Andy triages and scopes the request.',
      '- [ ] Runtime sync keeps the delivery board aligned with request/worker state.',
      '- [ ] Andy completes review and closes the request.',
    ].join('\n'),
    '',
    '### Risks and Dependencies',
    `Tracked automatically from Andy request \`${request.request_id}\`.`,
  ].join('\n');
}

export function deriveDeliveryWorkflowStatus(
  request: AndyRequestRecord,
): string {
  switch (request.state) {
    case 'received':
    case 'queued_for_coordinator':
      return 'Triage';
    case 'coordinator_active':
      return 'Architecture';
    case 'worker_queued':
      return 'Ready';
    case 'worker_running':
      return 'Worker Running';
    case 'worker_review_requested':
    case 'review_in_progress':
    case 'andy_patch_in_progress':
      return 'Review';
    case 'completed':
      return 'Done';
    case 'failed':
    case 'cancelled':
      return 'Blocked';
    default:
      return 'Triage';
  }
}

export function deriveDeliveryNextAction(
  request: AndyRequestRecord,
  run: DeliveryRun | null,
): string {
  switch (request.state) {
    case 'received':
    case 'queued_for_coordinator':
      return 'Andy to triage and scope the request';
    case 'coordinator_active':
      return 'Andy to finalize architecture and dispatch decision';
    case 'worker_queued':
      return 'Jarvis dispatch is queued; wait for worker start';
    case 'worker_running':
      return run?.group_folder
        ? `${run.group_folder} to execute and return completion artifacts`
        : 'Jarvis to execute and return completion artifacts';
    case 'worker_review_requested':
      return 'Andy to review the worker completion and choose approve, patch, or redispatch';
    case 'review_in_progress':
      return 'Andy to complete the review decision';
    case 'andy_patch_in_progress':
      return 'Andy to finish the bounded review patch on the same branch';
    case 'completed':
      return 'No action; delivery is complete';
    case 'failed':
      return 'Andy or human to inspect the blocker and decide retry/closure';
    case 'cancelled':
      return 'No action; request was cancelled';
    default:
      return 'Andy to inspect current delivery state';
  }
}

function deriveLastEvidence(
  request: AndyRequestRecord,
  run: DeliveryRun | null,
): string {
  const progress = run ? getWorkerRunProgress(run.run_id) : null;
  return (
    progress?.last_progress_summary?.trim() ||
    run?.test_summary?.trim() ||
    request.last_status_text?.trim() ||
    ''
  );
}

function deriveWorkerFieldValue(
  request: AndyRequestRecord,
  run: DeliveryRun | null,
): string {
  return run?.group_folder || request.worker_group_folder || 'none';
}

function deriveBranchValue(run: DeliveryRun | null): string {
  return run?.branch_name || run?.dispatch_branch || '';
}

function deriveMilestoneComment(
  request: AndyRequestRecord,
  run: DeliveryRun | null,
): { eventKey: string; body: string } | null {
  if (request.state === 'worker_queued' || request.state === 'worker_running') {
    if (!run) return null;
    return {
      eventKey: `dispatch:${run.run_id}`,
      body: [
        'Tracked delivery execution started.',
        '',
        `- Request: \`${request.request_id}\``,
        `- Worker: \`${run.group_folder}\``,
        `- Run: \`${run.run_id}\``,
        `- Branch: \`${deriveBranchValue(run) || 'pending'}\``,
      ].join('\n'),
    };
  }

  if (request.state === 'worker_review_requested') {
    if (!run) return null;
    return {
      eventKey: `review:${run.run_id}`,
      body: [
        'Jarvis returned completion artifacts for Andy review.',
        '',
        `- Request: \`${request.request_id}\``,
        `- Worker: \`${run.group_folder}\``,
        `- Run: \`${run.run_id}\``,
        `- Branch: \`${deriveBranchValue(run) || 'unknown'}\``,
        ...(run.pr_url ? [`- PR: ${run.pr_url}`] : []),
      ].join('\n'),
    };
  }

  if (request.state === 'completed') {
    return {
      eventKey: `completed:${run?.run_id || request.request_id}`,
      body: [
        'Andy marked this tracked delivery request complete.',
        '',
        `- Request: \`${request.request_id}\``,
        ...(run
          ? [
              `- Worker run: \`${run.run_id}\``,
              `- Branch: \`${deriveBranchValue(run) || 'unknown'}\``,
            ]
          : []),
        ...(run?.pr_url ? [`- PR: ${run.pr_url}`] : []),
      ].join('\n'),
    };
  }

  if (request.state === 'failed' || request.state === 'cancelled') {
    return {
      eventKey: `blocked:${request.state}:${run?.run_id || request.request_id}`,
      body: [
        'Tracked delivery request is blocked.',
        '',
        `- Request: \`${request.request_id}\``,
        `- State: \`${request.state}\``,
        ...(run ? [`- Worker run: \`${run.run_id}\``] : []),
        ...(request.last_status_text
          ? [`- Summary: ${request.last_status_text}`]
          : []),
      ].join('\n'),
    };
  }

  return null;
}

function preferredStatusField(project: DeliveryProject): string | null {
  return STATUS_FIELD_NAMES.find((name) => project.fields.has(name)) || null;
}

function optionIdForField(
  project: DeliveryProject,
  fieldName: string,
  optionName: string,
): string | null {
  const field = project.fields.get(fieldName);
  if (!field || field.type !== 'single_select' || !field.options) return null;
  return field.options.get(optionName) || null;
}

function resolveStatusOptionId(
  project: DeliveryProject,
  fieldName: string,
  statusName: string,
): string | null {
  const direct = optionIdForField(project, fieldName, statusName);
  if (direct) return direct;
  if (fieldName !== 'Status') return null;

  const fallback =
    statusName === 'Done'
      ? 'Done'
      : statusName === 'Review' || statusName === 'Worker Running'
        ? 'In Progress'
        : 'Todo';
  return optionIdForField(project, fieldName, fallback);
}

async function githubGraphql<T>(
  query: string,
  variables: Record<string, unknown>,
  fetchImpl: typeof fetch,
): Promise<T> {
  const response = await fetchImpl('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resolveGitHubToken()}`,
      'Content-Type': 'application/json',
      'User-Agent': 'nanoclaw-delivery-sync',
      'X-GitHub-Api-Version': GITHUB_API_VERSION,
    },
    body: JSON.stringify({ query, variables }),
  });
  const payload = (await response.json()) as {
    data?: T;
    errors?: Array<{ message?: string }>;
  };
  if (!response.ok || payload.errors?.length || !payload.data) {
    throw new Error(
      `GitHub GraphQL request failed: ${response.status} ${response.statusText} ${JSON.stringify(
        payload.errors || payload,
      )}`,
    );
  }
  return payload.data;
}

async function githubRest<T>(
  method: string,
  path: string,
  fetchImpl: typeof fetch,
  body?: Record<string, unknown>,
): Promise<T> {
  const response = await fetchImpl(`https://api.github.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${resolveGitHubToken()}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': 'nanoclaw-delivery-sync',
      'X-GitHub-Api-Version': GITHUB_API_VERSION,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = (await response.json()) as T & { message?: string };
  if (!response.ok) {
    throw new Error(
      `GitHub REST request failed: ${response.status} ${response.statusText} ${JSON.stringify(
        payload,
      )}`,
    );
  }
  return payload;
}

async function getDeliveryProject(
  fetchImpl: typeof fetch,
): Promise<DeliveryProject> {
  const now = Date.now();
  if (projectCache && now - projectCache.cachedAt < PROJECT_CACHE_TTL_MS) {
    return projectCache.project;
  }

  const data = await githubGraphql<{
    user?: {
      projectV2?: {
        id: string;
        title: string;
        fields: {
          nodes: Array<{
            __typename: string;
            id?: string;
            name?: string;
            options?: Array<{ id: string; name: string }>;
          } | null>;
        };
      } | null;
    } | null;
  }>(
    `
      query($owner: String!, $number: Int!) {
        user(login: $owner) {
          projectV2(number: $number) {
            id
            title
            fields(first: 100) {
              nodes {
                __typename
                ... on ProjectV2FieldCommon {
                  id
                  name
                }
                ... on ProjectV2SingleSelectField {
                  options {
                    id
                    name
                  }
                }
              }
            }
          }
        }
      }
    `,
    {
      owner: DELIVERY_PROJECT_OWNER,
      number: DELIVERY_PROJECT_NUMBER,
    },
    fetchImpl,
  );

  const project = data.user?.projectV2;
  if (!project) {
    throw new Error(
      `Delivery project ${DELIVERY_PROJECT_OWNER}#${DELIVERY_PROJECT_NUMBER} not found`,
    );
  }

  const fields = new Map<string, DeliveryProjectField>();
  for (const node of project.fields.nodes || []) {
    if (!node?.id || !node.name) continue;
    fields.set(node.name, {
      id: node.id,
      name: node.name,
      type:
        node.__typename === 'ProjectV2SingleSelectField'
          ? 'single_select'
          : node.__typename === 'ProjectV2Field'
            ? 'text'
            : node.__typename === 'ProjectV2TextField'
              ? 'text'
              : 'unknown',
      options: node.options
        ? new Map(node.options.map((option) => [option.name, option.id]))
        : undefined,
    });
  }

  const resolved: DeliveryProject = {
    id: project.id,
    title: project.title,
    fields,
  };
  projectCache = { project: resolved, cachedAt: now };
  return resolved;
}

async function getIssueInfo(
  issueNumber: number,
  fetchImpl: typeof fetch,
): Promise<DeliveryIssueInfo | null> {
  const data = await githubGraphql<{
    repository?: {
      issue?: {
        id: string;
        number: number;
        url: string;
        projectItems: {
          nodes: Array<{
            id: string;
            project: { id: string };
          } | null>;
        };
      } | null;
    } | null;
  }>(
    `
      query($owner: String!, $repo: String!, $number: Int!) {
        repository(owner: $owner, name: $repo) {
          issue(number: $number) {
            id
            number
            url
            projectItems(first: 20) {
              nodes {
                id
                project {
                  id
                }
              }
            }
          }
        }
      }
    `,
    {
      owner: DELIVERY_REPO_OWNER,
      repo: DELIVERY_REPO_NAME,
      number: issueNumber,
    },
    fetchImpl,
  );

  const issue = data.repository?.issue;
  if (!issue) return null;

  const project = await getDeliveryProject(fetchImpl);
  const currentItem = issue.projectItems.nodes.find(
    (node) => node?.project.id === project.id,
  );

  return {
    nodeId: issue.id,
    number: issue.number,
    url: issue.url,
    projectItemId: currentItem?.id || null,
  };
}

async function createIssue(
  request: AndyRequestRecord,
  fetchImpl: typeof fetch,
): Promise<DeliveryIssueInfo> {
  const payload = await githubRest<{
    number: number;
    html_url: string;
    node_id: string;
  }>(
    'POST',
    `/repos/${DELIVERY_REPO_OWNER}/${DELIVERY_REPO_NAME}/issues`,
    fetchImpl,
    {
      title: buildDeliveryIssueTitle(request.user_prompt),
      body: buildDeliveryIssueBody(request),
      labels: [
        'agent:andy-developer',
        'priority:p2',
        'risk:medium',
        'status:triage',
      ],
    },
  );

  return {
    nodeId: payload.node_id,
    number: payload.number,
    url: payload.html_url,
    projectItemId: null,
  };
}

class GitHubDeliveryApiClient implements DeliverySyncClient {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async ensureIssue(request: AndyRequestRecord): Promise<DeliveryIssueInfo> {
    if (request.github_issue_number) {
      const existing = await getIssueInfo(
        request.github_issue_number,
        this.fetchImpl,
      );
      if (existing) return existing;
    }

    const referencedIssueNumber = extractReferencedIssueNumber(
      request.user_prompt,
    );
    if (referencedIssueNumber) {
      const referenced = await getIssueInfo(
        referencedIssueNumber,
        this.fetchImpl,
      );
      if (referenced) return referenced;
    }

    return createIssue(request, this.fetchImpl);
  }

  async ensureProjectItem(
    request: AndyRequestRecord,
    issue: DeliveryIssueInfo,
  ): Promise<string> {
    if (issue.projectItemId) {
      return issue.projectItemId;
    }

    const project = await getDeliveryProject(this.fetchImpl);
    const data = await githubGraphql<{
      addProjectV2ItemById?: {
        item?: { id: string } | null;
      } | null;
    }>(
      `
        mutation($projectId: ID!, $contentId: ID!) {
          addProjectV2ItemById(input: { projectId: $projectId, contentId: $contentId }) {
            item {
              id
            }
          }
        }
      `,
      {
        projectId: project.id,
        contentId: issue.nodeId,
      },
      this.fetchImpl,
    );

    const itemId = data.addProjectV2ItemById?.item?.id;
    if (!itemId) {
      throw new Error(
        `Failed to add issue #${issue.number} to delivery project`,
      );
    }

    setAndyRequestGitHubProjectLink({
      requestId: request.request_id,
      boardKey: DELIVERY_BOARD_KEY,
      itemId,
    });
    return itemId;
  }

  async updateFields(
    itemId: string,
    updates: Record<string, string>,
  ): Promise<void> {
    const project = await getDeliveryProject(this.fetchImpl);

    for (const [fieldName, value] of Object.entries(updates)) {
      const resolvedFieldName =
        fieldName === 'Workflow Status'
          ? preferredStatusField(project)
          : fieldName;
      if (!resolvedFieldName) continue;
      const field = project.fields.get(resolvedFieldName);
      if (!field) continue;

      if (field.type === 'single_select') {
        const optionId =
          resolvedFieldName === 'Workflow Status' ||
          resolvedFieldName === 'Status'
            ? resolveStatusOptionId(project, resolvedFieldName, value)
            : optionIdForField(project, resolvedFieldName, value);
        if (!optionId) continue;
        await githubGraphql(
          `
            mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
              updateProjectV2ItemFieldValue(
                input: {
                  projectId: $projectId
                  itemId: $itemId
                  fieldId: $fieldId
                  value: { singleSelectOptionId: $optionId }
                }
              ) {
                projectV2Item {
                  id
                }
              }
            }
          `,
          {
            projectId: project.id,
            itemId,
            fieldId: field.id,
            optionId,
          },
          this.fetchImpl,
        );
        continue;
      }

      await githubGraphql(
        `
          mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $text: String!) {
            updateProjectV2ItemFieldValue(
              input: {
                projectId: $projectId
                itemId: $itemId
                fieldId: $fieldId
                value: { text: $text }
              }
            ) {
              projectV2Item {
                id
              }
            }
          }
        `,
        {
          projectId: project.id,
          itemId,
          fieldId: field.id,
          text: value,
        },
        this.fetchImpl,
      );
    }
  }

  async postIssueComment(
    issueNumber: number,
    body: string,
  ): Promise<string | null> {
    const payload = await githubRest<{ html_url?: string }>(
      'POST',
      `/repos/${DELIVERY_REPO_OWNER}/${DELIVERY_REPO_NAME}/issues/${issueNumber}/comments`,
      this.fetchImpl,
      { body },
    );
    return payload.html_url || null;
  }
}

function buildFieldUpdates(
  request: AndyRequestRecord,
  run: DeliveryRun | null,
): Record<string, string> {
  return {
    'Workflow Status': deriveDeliveryWorkflowStatus(request),
    Agent: 'andy-developer',
    Worker: deriveWorkerFieldValue(request, run),
    Source: 'user',
    'Review Lane': 'none',
    Priority: 'p2',
    Risk: 'medium',
    'Request State': request.state,
    'Worker Status': run?.status || '',
    'Request ID': request.request_id,
    'Run ID': run?.run_id || '',
    Branch: deriveBranchValue(run),
    'PR URL': run?.pr_url || '',
    'Last Evidence': deriveLastEvidence(request, run),
    'Next Action': deriveDeliveryNextAction(request, run),
  };
}

export async function syncTrackedDeliveryRequest(
  requestId: string,
  client: DeliverySyncClient = new GitHubDeliveryApiClient(),
): Promise<void> {
  if (!isDeliverySyncConfigured()) return;

  const request = getAndyRequestById(requestId);
  if (!request || request.intent !== 'work_intake') return;

  const issue = await client.ensureIssue(request);
  setAndyRequestGitHubIssueLink({
    requestId: request.request_id,
    issueNumber: issue.number,
    issueUrl: issue.url,
    repoFullName: `${DELIVERY_REPO_OWNER}/${DELIVERY_REPO_NAME}`,
  });

  const itemId = await client.ensureProjectItem(request, issue);
  setAndyRequestGitHubProjectLink({
    requestId: request.request_id,
    boardKey: DELIVERY_BOARD_KEY,
    itemId,
  });

  const run =
    (request.worker_run_id ? getWorkerRun(request.worker_run_id) : null) ??
    null;
  await client.updateFields(itemId, buildFieldUpdates(request, run));

  const milestone = deriveMilestoneComment(request, run);
  if (
    !milestone ||
    hasGitHubDeliveryEvent(request.request_id, milestone.eventKey)
  ) {
    return;
  }

  const commentUrl = await client.postIssueComment(
    issue.number,
    milestone.body,
  );
  recordGitHubDeliveryEvent({
    requestId: request.request_id,
    eventKey: milestone.eventKey,
    commentUrl,
  });
}

function queueSyncDrain(): void {
  if (syncDrainPromise) return;

  syncDrainPromise = (async () => {
    while (pendingSyncReasons.size > 0) {
      const batch = Array.from(pendingSyncReasons.entries());
      pendingSyncReasons.clear();
      for (const [requestId] of batch) {
        try {
          await syncTrackedDeliveryRequest(requestId);
        } catch (err) {
          logger.warn({ err, requestId }, 'GitHub delivery sync failed');
        }
      }
    }
  })().finally(() => {
    syncDrainPromise = null;
  });
}

export function scheduleAndyDeliverySync(
  requestId: string,
  reason = 'state_change',
): void {
  if (!requestId || !isDeliverySyncConfigured()) return;

  if (reason === 'progress') {
    const lastAt = lastProgressSyncAt.get(requestId) || 0;
    const now = Date.now();
    if (now - lastAt < PROGRESS_SYNC_THROTTLE_MS) return;
    lastProgressSyncAt.set(requestId, now);
  }

  pendingSyncReasons.set(requestId, reason);
  queueMicrotask(queueSyncDrain);
}

export function scheduleAndyDeliverySyncForRun(
  runId: string,
  reason = 'state_change',
): void {
  const request = getAndyRequestByWorkerRun(runId);
  if (!request) return;
  scheduleAndyDeliverySync(request.request_id, reason);
}
