import { beforeEach, describe, expect, it } from 'vitest';

import {
  _initTestDatabase,
  createAndyRequestIfAbsent,
  getAndyRequestById,
} from '../../db.js';
import {
  buildAndyRequestReplayMessageContent,
  buildAndyReviewTriggerMessage,
  completeAndyCoordinatorRequest,
  markAndyRequestsCoordinatorActive,
  parseAndyReviewStateUpdates,
  resolveAndyCoordinatorSessionOverride,
  selectAndyMessageBatch,
  shouldForceFreshAndyCoordinatorRun,
  shouldForceFreshAndySessionRun,
} from './request-state-service.js';

describe('parseAndyReviewStateUpdates', () => {
  beforeEach(() => {
    _initTestDatabase();
  });

  it('parses explicit review_state_update tags', () => {
    const updates = parseAndyReviewStateUpdates(
      '<review_state_update>{"request_id":"req-1","state":"completed","summary":"done"}</review_state_update>',
    );

    expect(updates).toEqual([
      {
        request_id: 'req-1',
        state: 'completed',
        summary: 'done',
      },
    ]);
  });

  it('parses plain Andy completion summaries as fallback updates', () => {
    const updates = parseAndyReviewStateUpdates(
      'Andy: REVIEW: req-1773661794890-661mgcfo — COMPLETED\nWorker pushed commit.',
    );

    expect(updates).toEqual([
      {
        request_id: 'req-1773661794890-661mgcfo',
        state: 'completed',
        summary:
          'REVIEW: req-1773661794890-661mgcfo — COMPLETED Worker pushed commit.',
      },
    ]);
  });

  it('parses stored status messages that reference an already completed request', () => {
    const updates = parseAndyReviewStateUpdates(
      'Andy: **Status: COMPLETED**\n\nRequest `req-1773661794890-661mgcfo` already completed.',
    );

    expect(updates).toEqual([
      {
        request_id: 'req-1773661794890-661mgcfo',
        state: 'completed',
        summary:
          '**Status: COMPLETED** Request `req-1773661794890-661mgcfo` already completed.',
      },
    ]);
  });

  it('parses completed pipeline summaries that use bold markdown around the request id', () => {
    const updates = parseAndyReviewStateUpdates(
      'Andy: The pipeline probe **req-1773674136564-370ltavk** is already **completed**.',
    );

    expect(updates).toEqual([
      {
        request_id: 'req-1773674136564-370ltavk',
        state: 'completed',
        summary:
          'The pipeline probe **req-1773674136564-370ltavk** is already **completed**.',
      },
    ]);
  });

  it('parses live pipeline completion summaries that omit the "already" wording', () => {
    const updates = parseAndyReviewStateUpdates(
      'Andy: Pipeline probe **req-1773674465809-120gnb02** completed.\n\nReady for next request.',
    );

    expect(updates).toEqual([
      {
        request_id: 'req-1773674465809-120gnb02',
        state: 'completed',
        summary:
          'Pipeline probe **req-1773674465809-120gnb02** completed. Ready for next request.',
      },
    ]);
  });

  it('does not reopen a terminal request when stale intake messages are replayed', () => {
    createAndyRequestIfAbsent({
      request_id: 'req-terminal-1',
      chat_jid: 'andy-developer@g.us',
      source_group_folder: 'andy-developer',
      source_lane_id: 'andy-developer',
      user_message_id: 'user-msg-terminal-1',
      user_prompt: 'Run the pipeline probe.',
      intent: 'work_intake',
      state: 'completed',
    });

    markAndyRequestsCoordinatorActive(
      [
        {
          requestId: 'req-terminal-1',
          messageId: 'user-msg-terminal-1',
          kind: 'coordinator',
        },
      ],
      'Coordinator picked up replayed message',
    );

    expect(getAndyRequestById('req-terminal-1')).toMatchObject({
      request_id: 'req-terminal-1',
      state: 'completed',
    });
  });

  it('forces a fresh coordinator session when a new intake request has no persisted session', () => {
    createAndyRequestIfAbsent({
      request_id: 'req-fresh-1',
      chat_jid: 'andy-developer@g.us',
      source_group_folder: 'andy-developer',
      source_lane_id: 'andy-developer',
      user_message_id: 'user-msg-fresh-1',
      user_prompt: 'Bootstrap a new project.',
      intent: 'work_intake',
      state: 'queued_for_coordinator',
    });

    expect(
      resolveAndyCoordinatorSessionOverride([
        {
          requestId: 'req-fresh-1',
          messageId: 'user-msg-fresh-1',
          kind: 'coordinator',
        },
      ]),
    ).toBeNull();
    expect(
      shouldForceFreshAndyCoordinatorRun([
        {
          requestId: 'req-fresh-1',
          messageId: 'user-msg-fresh-1',
          kind: 'coordinator',
        },
      ]),
    ).toBe(true);
  });

  it('reuses the persisted coordinator session when a request already has one', () => {
    createAndyRequestIfAbsent({
      request_id: 'req-session-1',
      chat_jid: 'andy-developer@g.us',
      source_group_folder: 'andy-developer',
      source_lane_id: 'andy-developer',
      user_message_id: 'user-msg-session-1',
      user_prompt: 'Continue the project bootstrap.',
      intent: 'work_intake',
      state: 'coordinator_active',
    });
    completeAndyCoordinatorRequest({
      requestId: 'req-session-1',
      coordinatorSessionId: 'sess-andy-123',
      runFailed: false,
    });

    expect(
      resolveAndyCoordinatorSessionOverride([
        {
          requestId: 'req-session-1',
          messageId: 'user-msg-session-1',
          kind: 'coordinator',
        },
      ]),
    ).toBe('sess-andy-123');
    expect(
      shouldForceFreshAndyCoordinatorRun([
        {
          requestId: 'req-session-1',
          messageId: 'user-msg-session-1',
          kind: 'coordinator',
        },
      ]),
    ).toBe(false);
  });

  it('forces a fresh session for review requests', () => {
    expect(
      shouldForceFreshAndySessionRun([
        {
          requestId: 'req-review-1',
          messageId: 'review-msg-1',
          kind: 'review',
        },
      ]),
    ).toBe(true);
  });

  it('defers older review messages when a fresh coordinator request arrives', () => {
    createAndyRequestIfAbsent({
      request_id: 'req-review-older',
      chat_jid: 'andy-developer@g.us',
      source_group_folder: 'andy-developer',
      source_lane_id: 'andy-developer',
      user_message_id: 'user-msg-review-older',
      user_prompt: 'Older review request.',
      intent: 'work_intake',
      state: 'worker_review_requested',
    });
    createAndyRequestIfAbsent({
      request_id: 'req-intake-new',
      chat_jid: 'andy-developer@g.us',
      source_group_folder: 'andy-developer',
      source_lane_id: 'andy-developer',
      user_message_id: 'user-msg-intake-new',
      user_prompt: 'Fresh task.',
      intent: 'work_intake',
      state: 'queued_for_coordinator',
    });

    const selection = selectAndyMessageBatch(
      [
        {
          id: 'review-msg-older',
          chat_jid: 'andy-developer@g.us',
          sender: 'nanoclaw-review@nanoclaw',
          sender_name: 'nanoclaw-review',
          content:
            '<review_request>{"request_id":"req-review-older","run_id":"run-review-older","repo":"openclaw-gurusharan/aadhaar-chain","branch":"jarvis-review-older","worker_group_folder":"jarvis-worker-1"}</review_request>',
          timestamp: '2026-03-16T18:00:00.000Z',
          is_from_me: false,
          is_bot_message: false,
        },
        {
          id: 'user-msg-intake-new',
          chat_jid: 'andy-developer@g.us',
          sender: 'uat-user@nanoclaw',
          sender_name: 'User',
          content: '@Andy handle the fresh task',
          timestamp: '2026-03-16T18:01:00.000Z',
          is_from_me: false,
          is_bot_message: false,
        },
      ],
      '2026-03-16T18:01:01.000Z',
    );

    expect(selection.activeRequestId).toBe('req-intake-new');
    expect(selection.selectedMessages.map((message) => message.id)).toEqual([
      'user-msg-intake-new',
    ]);
    expect(selection.deferredMessages).toHaveLength(1);
    expect(selection.deferredMessages[0]).toMatchObject({
      originalMessageId: 'review-msg-older',
      requestId: 'req-review-older',
    });
    expect(selection.deferredMessages[0]?.replayMessage.id).toContain(
      'deferred-review-msg-older-',
    );
    expect(selection.deferredMessages[0]?.replayMessage.timestamp).toBe(
      '2026-03-16T18:01:01.000Z',
    );
  });

  it('defers older coordinator requests behind a fresh coordinator intake', () => {
    createAndyRequestIfAbsent({
      request_id: 'req-intake-older',
      chat_jid: 'andy-developer@g.us',
      source_group_folder: 'andy-developer',
      source_lane_id: 'andy-developer',
      user_message_id: 'user-msg-intake-older',
      user_prompt: 'Older task.',
      intent: 'work_intake',
      state: 'queued_for_coordinator',
    });
    createAndyRequestIfAbsent({
      request_id: 'req-intake-newer',
      chat_jid: 'andy-developer@g.us',
      source_group_folder: 'andy-developer',
      source_lane_id: 'andy-developer',
      user_message_id: 'user-msg-intake-newer',
      user_prompt: 'Newer task.',
      intent: 'work_intake',
      state: 'queued_for_coordinator',
    });

    const selection = selectAndyMessageBatch(
      [
        {
          id: 'user-msg-intake-older',
          chat_jid: 'andy-developer@g.us',
          sender: 'uat-user@nanoclaw',
          sender_name: 'User',
          content: '@Andy retry the older task',
          timestamp: '2026-03-16T18:00:00.000Z',
          is_from_me: false,
          is_bot_message: false,
        },
        {
          id: 'user-msg-intake-newer',
          chat_jid: 'andy-developer@g.us',
          sender: 'uat-user@nanoclaw',
          sender_name: 'User',
          content: '@Andy handle the newer task',
          timestamp: '2026-03-16T18:01:00.000Z',
          is_from_me: false,
          is_bot_message: false,
        },
      ],
      '2026-03-16T18:01:01.000Z',
    );

    expect(selection.activeRequestId).toBe('req-intake-newer');
    expect(selection.selectedMessages.map((message) => message.id)).toEqual([
      'user-msg-intake-newer',
    ]);
    expect(selection.deferredMessages).toHaveLength(1);
    expect(selection.deferredMessages[0]).toMatchObject({
      originalMessageId: 'user-msg-intake-older',
      requestId: 'req-intake-older',
    });
    expect(selection.deferredMessages[0]?.replayMessage.id).toContain(
      'deferred-user-msg-intake-older-',
    );
  });

  it('parks deferred replay coordinator messages without replaying them again', () => {
    createAndyRequestIfAbsent({
      request_id: 'req-intake-older',
      chat_jid: 'andy-developer@g.us',
      source_group_folder: 'andy-developer',
      source_lane_id: 'andy-developer',
      user_message_id: 'user-msg-intake-older',
      user_prompt: 'Older task.',
      intent: 'work_intake',
      state: 'queued_for_coordinator',
    });
    createAndyRequestIfAbsent({
      request_id: 'req-intake-newer',
      chat_jid: 'andy-developer@g.us',
      source_group_folder: 'andy-developer',
      source_lane_id: 'andy-developer',
      user_message_id: 'user-msg-intake-newer',
      user_prompt: 'Newer task.',
      intent: 'work_intake',
      state: 'queued_for_coordinator',
    });

    const selection = selectAndyMessageBatch(
      [
        {
          id: 'deferred-user-msg-intake-older-1',
          chat_jid: 'andy-developer@g.us',
          sender: 'nanoclaw-replay@nanoclaw',
          sender_name: 'nanoclaw-replay',
          content: buildAndyRequestReplayMessageContent({
            content: '@Andy retry the older task',
            requestId: 'req-intake-older',
            kind: 'coordinator',
            originalMessageId: 'user-msg-intake-older',
          }),
          timestamp: '2026-03-16T18:00:30.000Z',
          is_from_me: false,
          is_bot_message: false,
        },
        {
          id: 'user-msg-intake-newer',
          chat_jid: 'andy-developer@g.us',
          sender: 'uat-user@nanoclaw',
          sender_name: 'User',
          content: '@Andy handle the newer task',
          timestamp: '2026-03-16T18:01:00.000Z',
          is_from_me: false,
          is_bot_message: false,
        },
      ],
      '2026-03-16T18:01:01.000Z',
    );

    expect(selection.activeRequestId).toBe('req-intake-newer');
    expect(selection.selectedMessages.map((message) => message.id)).toEqual([
      'user-msg-intake-newer',
    ]);
    expect(selection.deferredMessages).toHaveLength(0);
  });

  it('prefers a fresh coordinator request over a newer deferred review replay without creating a replay chain', () => {
    createAndyRequestIfAbsent({
      request_id: 'req-build-1',
      chat_jid: 'andy-developer@g.us',
      source_group_folder: 'andy-developer',
      source_lane_id: 'andy-developer',
      user_message_id: 'user-msg-build-1',
      user_prompt: 'Build the app.',
      intent: 'work_intake',
      state: 'queued_for_coordinator',
    });
    createAndyRequestIfAbsent({
      request_id: 'req-review-1',
      chat_jid: 'andy-developer@g.us',
      source_group_folder: 'andy-developer',
      source_lane_id: 'andy-developer',
      user_message_id: 'user-msg-review-1',
      user_prompt: 'Review prior worker output.',
      intent: 'work_intake',
      state: 'worker_review_requested',
    });

    const selection = selectAndyMessageBatch(
      [
        {
          id: 'user-msg-build-1',
          chat_jid: 'andy-developer@g.us',
          sender: 'uat-user@nanoclaw',
          sender_name: 'User',
          content: '@Andy add filter controls',
          timestamp: '2026-03-17T06:01:41.532Z',
          is_from_me: false,
          is_bot_message: false,
        },
        {
          id: 'deferred-review-1',
          chat_jid: 'andy-developer@g.us',
          sender: 'nanoclaw-review@nanoclaw',
          sender_name: 'nanoclaw-review',
          content: buildAndyRequestReplayMessageContent({
            content:
              '<review_request>{"request_id":"req-review-1","run_id":"run-review-1","repo":"openclaw-gurusharan/launchdeck","branch":"jarvis-launchdeck-build","worker_group_folder":"jarvis-worker-1"}</review_request>',
            requestId: 'req-review-1',
            kind: 'review',
            originalMessageId: 'review-msg-review-1',
          }),
          timestamp: '2026-03-17T06:01:43.349Z',
          is_from_me: false,
          is_bot_message: false,
        },
      ],
      '2026-03-17T06:01:44.000Z',
    );

    expect(selection.activeRequestId).toBe('req-build-1');
    expect(selection.selectedMessages.map((message) => message.id)).toEqual([
      'user-msg-build-1',
    ]);
    expect(selection.deferredMessages).toHaveLength(0);
  });

  it('keeps a deferred review parked while a newer coordinator request is still active in the same chat', () => {
    createAndyRequestIfAbsent({
      request_id: 'req-build-new',
      chat_jid: 'andy-developer@g.us',
      source_group_folder: 'andy-developer',
      source_lane_id: 'andy-developer',
      user_message_id: 'user-msg-build-new',
      user_prompt: 'Build the new app.',
      intent: 'work_intake',
      state: 'coordinator_active',
    });
    createAndyRequestIfAbsent({
      request_id: 'req-review-old',
      chat_jid: 'andy-developer@g.us',
      source_group_folder: 'andy-developer',
      source_lane_id: 'andy-developer',
      user_message_id: 'user-msg-review-old',
      user_prompt: 'Review prior worker output.',
      intent: 'work_intake',
      state: 'worker_review_requested',
    });

    const selection = selectAndyMessageBatch(
      [
        {
          id: 'deferred-review-old',
          chat_jid: 'andy-developer@g.us',
          sender: 'nanoclaw-review@nanoclaw',
          sender_name: 'nanoclaw-review',
          content: buildAndyRequestReplayMessageContent({
            content:
              '<review_request>{"request_id":"req-review-old","run_id":"run-review-old","repo":"openclaw-gurusharan/launchdeck","branch":"jarvis-launchdeck-build","worker_group_folder":"jarvis-worker-1"}</review_request>',
            requestId: 'req-review-old',
            kind: 'review',
            originalMessageId: 'review-msg-review-old',
          }),
          timestamp: '2026-03-17T06:01:43.349Z',
          is_from_me: false,
          is_bot_message: false,
        },
      ],
      '2026-03-17T06:01:44.000Z',
    );

    expect(selection.activeRequestId).toBe('req-build-new');
    expect(selection.selectedMessages).toHaveLength(0);
    expect(selection.deferredMessages).toHaveLength(0);
  });
});

describe('buildAndyReviewTriggerMessage', () => {
  it('includes an explicit approve contract that forbids worker chat messages', () => {
    const message = buildAndyReviewTriggerMessage({
      chatJid: 'andy-developer@g.us',
      timestamp: '2026-03-16T00:00:00.000Z',
      payload: {
        request_id: 'req-review-1',
        run_id: 'run-review-1',
        repo: 'openclaw-gurusharan/aadhaar-chain',
        branch: 'jarvis-review-1',
        worker_group_folder: 'jarvis-worker-1',
      },
    });

    expect(message.content).toContain('<review_contract>');
    expect(message.content).toContain(
      '<review_state_update>{"request_id":"req-review-1","state":"completed","summary":"..."}</review_state_update>',
    );
    expect(message.content).toContain(
      'Do not send any chat message to jarvis-worker-* when approving.',
    );
    expect(message.content).toContain(
      'Emit <review_state_update> directly in your assistant response body. Do not send it via mcp__nanoclaw__send_message.',
    );
  });

  it('requires a Notion pipeline probe page for probe-style branches', () => {
    const message = buildAndyReviewTriggerMessage({
      chatJid: 'andy-developer@g.us',
      timestamp: '2026-03-16T00:00:00.000Z',
      payload: {
        request_id: 'req-review-probe-1',
        run_id: 'run-review-probe-1',
        repo: 'openclaw-gurusharan/aadhaar-chain',
        branch: 'jarvis-nan-54-probe-1773682192891-dyv6s',
        worker_group_folder: 'jarvis-worker-1',
      },
    });

    expect(message.content).toContain(
      'For this pipeline probe, create a Notion page titled "Pipeline Probe 1773682192891-dyv6s" with notion_create_page before you emit completed.',
    );
    expect(message.content).toContain(
      'Notion memory alone does not satisfy pipeline-probe completion.',
    );
  });
});
