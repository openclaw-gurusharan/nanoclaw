import {
  createAndyRequestIfAbsent,
  getAndyRequestById,
  getLatestActiveAndyCoordinatorRequest,
  getAndyRequestByMessageId,
  insertDispatchAttempt,
  linkAndyRequestToWorkerRun,
  setAndyRequestCoordinatorSession,
  type AndyRequestRecord,
  type AndyRequestState,
  updateAndyRequestByWorkerRun,
  updateAndyRequestState,
} from '../../db.js';
import { type NewMessage } from '../../types.js';
import { resolveLaneIdFromGroupFolder } from './lanes.js';

const REVIEW_REQUEST_PATTERN =
  /<review_request>\s*([\s\S]*?)\s*<\/review_request>/i;
const ANDY_REQUEST_REPLAY_PATTERN =
  /<andy_request_replay>\s*([\s\S]*?)\s*<\/andy_request_replay>/i;
const REVIEW_STATE_UPDATE_PATTERN =
  /<review_state_update>\s*([\s\S]*?)\s*<\/review_state_update>/gi;
const LEADING_ANDY_PREFIX_PATTERN = /^\s*Andy:\s*/i;
const PLAIN_COMPLETED_PATTERNS = [
  /REVIEW:\s*(req-[a-z0-9-]+)\s*[—-]\s*COMPLETED/gi,
  /Pipeline Probe COMPLETED:\s*(req-[a-z0-9-]+)/gi,
  /Request\s+`?(req-[a-z0-9-]+)`?\s+already\s+completed/gi,
  /pipeline probe\s+\**(req-[a-z0-9-]+)\**\s+completed\b/gi,
  /pipeline probe\s+\**(req-[a-z0-9-]+)\**\s+is\s+\**already\s+\**completed\**/gi,
];
const PLAIN_FAILED_PATTERNS = [
  /REVIEW:\s*(req-[a-z0-9-]+)\s*[—-]\s*FAILED/gi,
  /Pipeline Probe FAILED:\s*(req-[a-z0-9-]+)/gi,
  /Request\s+`?(req-[a-z0-9-]+)`?\s+already\s+failed/gi,
];

export interface AndyRequestMessageRef {
  requestId: string;
  messageId: string;
  kind: 'coordinator' | 'review';
  isReplay?: boolean;
}

export interface AndyReviewRequestPayload {
  request_id: string;
  run_id: string;
  repo: string;
  branch: string;
  worker_group_folder: string;
  summary?: string;
  session_id?: string | null;
  parent_run_id?: string | null;
  commit_sha?: string | null;
  test_result?: string | null;
  risk?: string | null;
  pr_url?: string | null;
  pr_skipped_reason?: string | null;
}

export interface AndyReviewStateUpdate {
  request_id: string;
  state:
    | 'review_in_progress'
    | 'andy_patch_in_progress'
    | 'completed'
    | 'failed';
  summary?: string;
}

export interface AndyRequestReplayMetadata {
  request_id: string;
  kind: 'coordinator' | 'review';
  original_message_id?: string;
}

export interface DeferredAndyMessage {
  originalMessageId: string;
  requestId: string;
  replayMessage: NewMessage;
}

export interface AndyMessageBatchSelection {
  selectedMessages: NewMessage[];
  activeRequestId?: string;
  deferredMessages: DeferredAndyMessage[];
}

function extractPipelineProbeToken(branch: string): string | null {
  const match = branch.match(/-probe-([a-z0-9-]+)$/i);
  return match?.[1]?.trim() || null;
}

function parseJsonBlock<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function parseAndyRequestReplayMetadata(
  content: string,
): AndyRequestReplayMetadata | null {
  const match = content.match(ANDY_REQUEST_REPLAY_PATTERN);
  if (!match?.[1]) return null;

  const parsed = parseJsonBlock<AndyRequestReplayMetadata>(match[1]);
  if (!parsed) return null;
  if (
    typeof parsed.request_id !== 'string' ||
    !parsed.request_id.trim() ||
    (parsed.kind !== 'coordinator' && parsed.kind !== 'review')
  ) {
    return null;
  }

  if (
    parsed.original_message_id != null &&
    (typeof parsed.original_message_id !== 'string' ||
      !parsed.original_message_id.trim())
  ) {
    return null;
  }

  return parsed;
}

export function stripAndyRequestReplayMetadata(content: string): string {
  return content.replace(ANDY_REQUEST_REPLAY_PATTERN, '').trim();
}

export function buildAndyRequestReplayMessageContent(input: {
  content: string;
  requestId: string;
  kind: 'coordinator' | 'review';
  originalMessageId: string;
}): string {
  const metadata: AndyRequestReplayMetadata = {
    request_id: input.requestId,
    kind: input.kind,
    original_message_id: input.originalMessageId,
  };
  const cleanContent = stripAndyRequestReplayMetadata(input.content);
  return `<andy_request_replay>${JSON.stringify(metadata)}</andy_request_replay>\n${cleanContent}`;
}

export function resolveAndyRequestForMessage(
  message: Pick<NewMessage, 'id' | 'content'>,
): AndyRequestRecord | undefined {
  const direct = getAndyRequestByMessageId(message.id);
  if (direct) return direct;

  const replay = parseAndyRequestReplayMetadata(message.content);
  if (!replay) return undefined;
  return getAndyRequestById(replay.request_id);
}

export function parseAndyReviewRequestMessage(
  content: string,
): AndyReviewRequestPayload | null {
  const match = stripAndyRequestReplayMetadata(content).match(
    REVIEW_REQUEST_PATTERN,
  );
  if (!match?.[1]) return null;

  const parsed = parseJsonBlock<AndyReviewRequestPayload>(match[1]);
  if (!parsed) return null;
  if (
    typeof parsed.request_id !== 'string' ||
    !parsed.request_id.trim() ||
    typeof parsed.run_id !== 'string' ||
    !parsed.run_id.trim() ||
    typeof parsed.repo !== 'string' ||
    !parsed.repo.trim() ||
    typeof parsed.branch !== 'string' ||
    !parsed.branch.trim() ||
    typeof parsed.worker_group_folder !== 'string' ||
    !parsed.worker_group_folder.trim()
  ) {
    return null;
  }

  return parsed;
}

export function buildAndyReviewTriggerMessage(input: {
  chatJid: string;
  timestamp: string;
  payload: AndyReviewRequestPayload;
}): NewMessage {
  const pipelineProbeToken = extractPipelineProbeToken(input.payload.branch);
  const reviewContractLines = [
    `Approve path: emit <review_state_update>{"request_id":"${input.payload.request_id}","state":"completed","summary":"..."}</review_state_update>.`,
    'Do not send any chat message to jarvis-worker-* when approving.',
    'Only send a jarvis-worker message if you are dispatching strict JSON for rework.',
    'If you need a bounded direct patch yourself, emit andy_patch_in_progress instead of messaging a worker.',
  ];
  if (pipelineProbeToken) {
    reviewContractLines.push(
      `For this pipeline probe, create a Notion page titled "Pipeline Probe ${pipelineProbeToken}" with notion_create_page before you emit completed.`,
      'Notion memory alone does not satisfy pipeline-probe completion.',
    );
  }
  reviewContractLines.push(
    'Emit <review_state_update> directly in your assistant response body. Do not send it via mcp__nanoclaw__send_message.',
  );
  return {
    id: `review-${input.payload.run_id}`,
    chat_jid: input.chatJid,
    sender: 'nanoclaw-review@nanoclaw',
    sender_name: 'nanoclaw-review',
    content: [
      '<review_request>',
      JSON.stringify(input.payload, null, 2),
      '</review_request>',
      '<review_contract>',
      ...reviewContractLines,
      '</review_contract>',
    ].join('\n'),
    timestamp: input.timestamp,
    is_from_me: false,
    is_bot_message: false,
  };
}

export function parseAndyReviewStateUpdates(
  content: string,
): AndyReviewStateUpdate[] {
  const normalizedContent = content.replace(LEADING_ANDY_PREFIX_PATTERN, '');
  const updates: AndyReviewStateUpdate[] = [];
  const seen = new Set<string>();
  for (const match of normalizedContent.matchAll(REVIEW_STATE_UPDATE_PATTERN)) {
    const parsed = parseJsonBlock<AndyReviewStateUpdate>(match[1] || '');
    if (!parsed) continue;
    if (
      typeof parsed.request_id !== 'string' ||
      !parsed.request_id.trim() ||
      ![
        'review_in_progress',
        'andy_patch_in_progress',
        'completed',
        'failed',
      ].includes(parsed.state)
    ) {
      continue;
    }
    seen.add(parsed.request_id);
    updates.push(parsed);
  }

  const summary = stripAndyReviewStateUpdates(normalizedContent)
    .replace(/\s+/g, ' ')
    .slice(0, 240);

  const collectPlainUpdates = (
    patterns: RegExp[],
    state: AndyReviewStateUpdate['state'],
  ): void => {
    for (const pattern of patterns) {
      for (const match of normalizedContent.matchAll(pattern)) {
        const requestId = match[1]?.trim();
        if (!requestId || seen.has(requestId)) continue;
        seen.add(requestId);
        updates.push({
          request_id: requestId,
          state,
          summary,
        });
      }
    }
  };

  collectPlainUpdates(PLAIN_COMPLETED_PATTERNS, 'completed');
  collectPlainUpdates(PLAIN_FAILED_PATTERNS, 'failed');
  return updates;
}

export function stripAndyReviewStateUpdates(content: string): string {
  return content
    .replace(LEADING_ANDY_PREFIX_PATTERN, '')
    .replace(REVIEW_STATE_UPDATE_PATTERN, '')
    .trim();
}

export function createAndyWorkIntakeRequest(input: {
  requestId: string;
  chatJid: string;
  sourceGroupFolder: string;
  userMessageId: string;
  userPrompt: string;
}): { requestId: string; created: boolean } {
  const sourceLaneId = resolveLaneIdFromGroupFolder(input.sourceGroupFolder);
  const created = createAndyRequestIfAbsent({
    request_id: input.requestId,
    chat_jid: input.chatJid,
    source_group_folder: input.sourceGroupFolder,
    source_lane_id: sourceLaneId,
    user_message_id: input.userMessageId,
    user_prompt: input.userPrompt,
    intent: 'work_intake',
    state: 'queued_for_coordinator',
  });
  return {
    requestId: created.request_id,
    created: created.created,
  };
}

export function listTrackedAndyRequestRefsForMessages(
  messages: NewMessage[],
): AndyRequestMessageRef[] {
  const seen = new Set<string>();
  const rows: AndyRequestMessageRef[] = [];
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const replay = parseAndyRequestReplayMetadata(messages[i].content);
    if (replay && !seen.has(replay.request_id)) {
      const request = getAndyRequestById(replay.request_id);
      if (request) {
        seen.add(replay.request_id);
        rows.push({
          requestId: replay.request_id,
          messageId: messages[i].id,
          kind: replay.kind,
          isReplay: true,
        });
        continue;
      }
    }

    const reviewTrigger = parseAndyReviewRequestMessage(messages[i].content);
    if (reviewTrigger && !seen.has(reviewTrigger.request_id)) {
      const request = getAndyRequestById(reviewTrigger.request_id);
      if (request) {
        seen.add(reviewTrigger.request_id);
        rows.push({
          requestId: reviewTrigger.request_id,
          messageId: messages[i].id,
          kind: 'review',
          isReplay: false,
        });
        continue;
      }
    }

    const request = getAndyRequestByMessageId(messages[i].id);
    if (!request || seen.has(request.request_id)) continue;
    seen.add(request.request_id);
    rows.push({
      requestId: request.request_id,
      messageId: messages[i].id,
      kind: 'coordinator',
      isReplay: false,
    });
  }
  return rows;
}

export function markAndyRequestsCoordinatorActive(
  requests: AndyRequestMessageRef[],
  statusText: string,
): void {
  for (const request of requests) {
    if (request.kind !== 'coordinator') continue;
    const current = getAndyRequestById(request.requestId);
    if (
      !current ||
      current.state === 'completed' ||
      current.state === 'failed' ||
      current.state === 'cancelled'
    ) {
      continue;
    }
    updateAndyRequestState(request.requestId, 'coordinator_active', statusText);
  }
}

export function markAndyRequestsReviewInProgress(
  requests: AndyRequestMessageRef[],
  statusText: string,
): void {
  for (const request of requests) {
    if (request.kind !== 'review') continue;
    const current = getAndyRequestById(request.requestId);
    if (
      !current ||
      current.state === 'completed' ||
      current.state === 'failed' ||
      current.state === 'cancelled'
    ) {
      continue;
    }
    updateAndyRequestState(request.requestId, 'review_in_progress', statusText);
  }
}

export function attachAndyRequestToWorkerRun(
  requestId: string,
  runId: string,
  workerGroupFolder: string,
  nextState: AndyRequestState = 'worker_queued',
): void {
  linkAndyRequestToWorkerRun(requestId, runId, workerGroupFolder, nextState);
}

export function syncAndyRequestWithWorkerRun(
  runId: string,
  state: AndyRequestState,
  lastStatusText?: string | null,
): void {
  updateAndyRequestByWorkerRun(runId, state, lastStatusText);
}

export function applyAndyReviewStateUpdates(
  updates: AndyReviewStateUpdate[],
): void {
  for (const update of updates) {
    const request = getAndyRequestById(update.request_id);
    if (!request) continue;
    updateAndyRequestState(
      update.request_id,
      update.state,
      update.summary ?? null,
    );
  }
}

export function setAndyCoordinatorSession(
  requestId: string,
  sessionId: string | null,
): void {
  setAndyRequestCoordinatorSession(requestId, sessionId);
}

export function resolveAndyCoordinatorSessionOverride(
  requests: AndyRequestMessageRef[],
): string | null | undefined {
  const firstRequest = requests[0];
  if (!firstRequest) return undefined;

  const current = getAndyRequestById(firstRequest.requestId);
  const persistedSessionId = current?.coordinator_session_id?.trim();
  if (persistedSessionId) {
    return persistedSessionId;
  }

  if (firstRequest.kind === 'coordinator') {
    return null;
  }

  return undefined;
}

export function shouldForceFreshAndyCoordinatorRun(
  requests: AndyRequestMessageRef[],
): boolean {
  return resolveAndyCoordinatorSessionOverride(requests) === null;
}

export function shouldForceFreshAndySessionRun(
  requests: AndyRequestMessageRef[],
): boolean {
  const firstRequest = requests[0];
  if (!firstRequest) return false;
  if (firstRequest.kind === 'review') return true;
  return shouldForceFreshAndyCoordinatorRun(requests);
}

function isTerminalRequestState(state: string | undefined): boolean {
  return state === 'completed' || state === 'failed' || state === 'cancelled';
}

export function selectAndyMessageBatch(
  messages: NewMessage[],
  replayTimestamp: string,
): AndyMessageBatchSelection {
  const refs = listTrackedAndyRequestRefsForMessages(messages);
  const chatJid = messages[0]?.chat_jid;
  const latestActiveCoordinator = chatJid
    ? getLatestActiveAndyCoordinatorRequest(chatJid)
    : undefined;
  const activeRequest =
    refs.find((ref) => ref.kind === 'coordinator' && !ref.isReplay) ??
    refs.find((ref) => ref.kind === 'coordinator') ??
    refs[0];
  if (!activeRequest) {
    return {
      selectedMessages: messages,
      deferredMessages: [],
    };
  }

  if (activeRequest.kind !== 'coordinator') {
    if (
      latestActiveCoordinator &&
      latestActiveCoordinator.request_id !== activeRequest.requestId
    ) {
      return {
        selectedMessages: [],
        activeRequestId: latestActiveCoordinator.request_id,
        deferredMessages: [],
      };
    }
    return {
      selectedMessages: messages,
      activeRequestId: activeRequest.requestId,
      deferredMessages: [],
    };
  }

  const deferredMessages: DeferredAndyMessage[] = [];
  const deferredIds = new Set<string>();

  for (const ref of refs) {
    if (ref.requestId === activeRequest.requestId) continue;

    const request = getAndyRequestById(ref.requestId);
    if (isTerminalRequestState(request?.state)) continue;

    const original = messages.find((message) => message.id === ref.messageId);
    if (!original) continue;

    deferredIds.add(original.id);
    if (parseAndyRequestReplayMetadata(original.content)) {
      continue;
    }
    deferredMessages.push({
      originalMessageId: original.id,
      requestId: ref.requestId,
      replayMessage: {
        ...original,
        id: `deferred-${original.id}-${Date.now().toString(36)}`,
        content: buildAndyRequestReplayMessageContent({
          content: original.content,
          requestId: ref.requestId,
          kind: ref.kind,
          originalMessageId: original.id,
        }),
        timestamp: replayTimestamp,
      },
    });
  }

  return {
    selectedMessages:
      deferredIds.size > 0
        ? messages.filter((message) => !deferredIds.has(message.id))
        : messages,
    activeRequestId: activeRequest.requestId,
    deferredMessages,
  };
}

export function markAndyRequestDispatchBlocked(input: {
  requestId?: string;
  sourceLaneId: string;
  targetLaneId: string;
  runId?: string;
  reasonCode: string;
  reasonText: string;
  dispatchPayload?: string;
  sessionStrategy?: string;
}): string {
  const attemptId = insertDispatchAttempt({
    request_id: input.requestId,
    source_lane_id: input.sourceLaneId,
    target_lane_id: input.targetLaneId,
    run_id: input.runId,
    status: 'blocked',
    reason_code: input.reasonCode,
    reason_text: input.reasonText,
    session_strategy: input.sessionStrategy,
    dispatch_payload: input.dispatchPayload,
  });

  if (input.requestId) {
    updateAndyRequestState(
      input.requestId,
      'failed',
      `Dispatch blocked before worker queue: ${input.reasonText}`,
    );
  }

  return attemptId;
}

export function recordQueuedDispatchAttempt(input: {
  requestId?: string;
  sourceLaneId: string;
  targetLaneId: string;
  runId: string;
  queueState: 'new' | 'retry';
  dispatchPayload?: string;
  sessionStrategy?: string;
}): string {
  return insertDispatchAttempt({
    request_id: input.requestId,
    source_lane_id: input.sourceLaneId,
    target_lane_id: input.targetLaneId,
    run_id: input.runId,
    status: 'queued',
    reason_code: input.queueState === 'retry' ? 'retry' : null,
    reason_text:
      input.queueState === 'retry'
        ? 'retry queued after terminal failure'
        : null,
    session_strategy: input.sessionStrategy,
    dispatch_payload: input.dispatchPayload,
  });
}

export function completeAndyCoordinatorRequest(input: {
  requestId: string;
  coordinatorSessionId: string | null;
  runFailed: boolean;
  errorText?: string | null;
}): void {
  setAndyCoordinatorSession(input.requestId, input.coordinatorSessionId);
  const current = getAndyRequestById(input.requestId);
  if (!current) return;
  if (current.worker_run_id || `${current.state}`.startsWith('worker_')) return;

  if (input.runFailed) {
    updateAndyRequestState(
      input.requestId,
      'failed',
      input.errorText || 'Coordinator failed before dispatch',
    );
    return;
  }

  updateAndyRequestState(
    input.requestId,
    'completed',
    'Coordinator response delivered',
  );
}
