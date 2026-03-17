import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  _initTestDatabase,
  createAndyRequestIfAbsent,
  getAndyRequestByMessageId,
  listActiveAndyRequests,
  updateAndyRequestState,
} from '../../db.js';
import {
  buildAndyFrontdeskContextBlock,
  buildAndyProgressStatusReply,
  getAndyRequestsForMessages,
  handleAndyFrontdeskMessages,
} from './frontdesk-service.js';
import { buildAndyRequestReplayMessageContent } from './request-state-service.js';
import {
  type Channel,
  type NewMessage,
  type RegisteredGroup,
} from '../../types.js';

const ANDY_GROUP: RegisteredGroup = {
  name: 'Andy Developer',
  folder: 'andy-developer',
  trigger: '@Andy',
  added_at: '2024-01-01T00:00:00.000Z',
};

const STATUS_QUERY_MESSAGE: NewMessage = {
  id: 'msg-status-right-now',
  chat_jid: 'andy-developer@g.us',
  sender: 'user@s.whatsapp.net',
  sender_name: 'User',
  content: '@Andy what are you working on right now?',
  timestamp: '2026-03-06T10:00:00.000Z',
};

const MIXED_WORK_MESSAGE: NewMessage = {
  id: 'msg-status-plus-work',
  chat_jid: 'andy-developer@g.us',
  sender: 'user@s.whatsapp.net',
  sender_name: 'User',
  content:
    '@Andy what are you working on right now? Also create a fresh NAN-54 pipeline probe for aadhaar-chain.',
  timestamp: '2026-03-06T10:01:00.000Z',
};

describe('frontdesk-service', () => {
  beforeEach(() => {
    _initTestDatabase();
  });

  it('treats "what are you working on right now" as status, not intake', async () => {
    const sent: string[] = [];
    const channel: Channel = {
      name: 'test',
      connect: async () => {},
      sendMessage: async (_jid, text) => {
        sent.push(text);
      },
      isConnected: () => true,
      ownsJid: () => true,
      disconnect: async () => {},
    };

    const handled = await handleAndyFrontdeskMessages({
      chatJid: STATUS_QUERY_MESSAGE.chat_jid,
      group: ANDY_GROUP,
      messages: [STATUS_QUERY_MESSAGE],
      channel,
      runtime: {
        markCursorInFlight: () => {},
        clearInFlightCursor: () => {},
        markBatchProcessed: () => {},
        commitInFlightCursor: () => {},
      },
    });

    expect(handled).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain('There are no worker runs yet');
    expect(getAndyRequestByMessageId(STATUS_QUERY_MESSAGE.id)).toBeUndefined();
    expect(listActiveAndyRequests(STATUS_QUERY_MESSAGE.chat_jid)).toHaveLength(
      0,
    );
  });

  it('treats "what is the current progress" as status, not intake', async () => {
    const sent: string[] = [];
    const channel: Channel = {
      name: 'test',
      connect: async () => {},
      sendMessage: async (_jid, text) => {
        sent.push(text);
      },
      isConnected: () => true,
      ownsJid: () => true,
      disconnect: async () => {},
    };

    const message: NewMessage = {
      id: 'msg-current-progress',
      chat_jid: 'andy-developer@g.us',
      sender: 'user@s.whatsapp.net',
      sender_name: 'User',
      content: '@Andy what is the current progress',
      timestamp: '2026-03-06T10:00:00.000Z',
    };

    const handled = await handleAndyFrontdeskMessages({
      chatJid: message.chat_jid,
      group: ANDY_GROUP,
      messages: [message],
      channel,
      runtime: {
        markCursorInFlight: () => {},
        clearInFlightCursor: () => {},
        markBatchProcessed: () => {},
        commitInFlightCursor: () => {},
      },
    });

    expect(handled).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain('There are no worker runs yet');
    expect(getAndyRequestByMessageId(message.id)).toBeUndefined();
    expect(listActiveAndyRequests(message.chat_jid)).toHaveLength(0);
  });

  it('does not send a status reply when the same batch also contains real work', async () => {
    const sent: string[] = [];
    const channel: Channel = {
      name: 'test',
      connect: async () => {},
      sendMessage: async (_jid, text) => {
        sent.push(text);
      },
      isConnected: () => true,
      ownsJid: () => true,
      disconnect: async () => {},
    };

    const handled = await handleAndyFrontdeskMessages({
      chatJid: MIXED_WORK_MESSAGE.chat_jid,
      group: ANDY_GROUP,
      messages: [MIXED_WORK_MESSAGE],
      channel,
      runtime: {
        markCursorInFlight: () => {},
        clearInFlightCursor: () => {},
        markBatchProcessed: () => {},
        commitInFlightCursor: () => {},
      },
    });

    expect(handled).toBe(false);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain('Tracking this as');
    expect(sent[0]).not.toContain('Current tracked requests');
    expect(getAndyRequestByMessageId(MIXED_WORK_MESSAGE.id)).toBeDefined();
  });

  it('can probe frontdesk-only handling without creating intake for real work', async () => {
    const sent: string[] = [];
    const channel: Channel = {
      name: 'test',
      connect: async () => {},
      sendMessage: async (_jid, text) => {
        sent.push(text);
      },
      isConnected: () => true,
      ownsJid: () => true,
      disconnect: async () => {},
    };

    const workMessage: NewMessage = {
      id: 'msg-work-precheck',
      chat_jid: 'andy-developer@g.us',
      sender: 'user@s.whatsapp.net',
      sender_name: 'User',
      content: '@Andy build a launch tracker',
      timestamp: '2026-03-06T10:02:00.000Z',
    };

    const handled = await handleAndyFrontdeskMessages({
      chatJid: workMessage.chat_jid,
      group: ANDY_GROUP,
      messages: [workMessage],
      channel,
      ackIntake: false,
      runtime: {
        markCursorInFlight: () => {},
        clearInFlightCursor: () => {},
        markBatchProcessed: () => {},
        commitInFlightCursor: () => {},
      },
    });

    expect(handled).toBe(false);
    expect(sent).toHaveLength(0);
    expect(getAndyRequestByMessageId(workMessage.id)).toBeUndefined();
  });

  it('includes strict worker dispatch rules in the frontdesk context block', () => {
    const block = buildAndyFrontdeskContextBlock(
      'andy-developer@g.us',
      'req-ctx-1',
    );

    expect(block).toContain('request_id: req-ctx-1');
    expect(block).toContain(
      'emit exactly one strict JSON object and nothing else',
    );
    expect(block).toContain(
      'Allowed task_type values: analyze, implement, fix, refactor, test, release, research, code.',
    );
    expect(block).toContain('branch must match jarvis-<feature>.');
    expect(block).toContain(
      'Use mcp__nanoclaw__send_message to the intended jarvis-worker-* group JID',
    );
  });

  it('does not ack internal review triggers or create new intake requests', async () => {
    const sent: string[] = [];
    const channel: Channel = {
      name: 'test',
      connect: async () => {},
      sendMessage: async (_jid, text) => {
        sent.push(text);
      },
      isConnected: () => true,
      ownsJid: () => true,
      disconnect: async () => {},
    };

    const reviewTrigger: NewMessage = {
      id: 'msg-review-trigger-1',
      chat_jid: 'andy-developer@g.us',
      sender: 'nanoclaw-review@nanoclaw',
      sender_name: 'nanoclaw-review',
      content: `<review_request>
{
  "request_id": "req-review-1",
  "run_id": "run-review-1",
  "repo": "openclaw-gurusharan/nanoclaw",
  "branch": "jarvis-review-1",
  "worker_group_folder": "jarvis-worker-1"
}
</review_request>`,
      timestamp: '2026-03-07T10:10:00.000Z',
    };

    const handled = await handleAndyFrontdeskMessages({
      chatJid: reviewTrigger.chat_jid,
      group: ANDY_GROUP,
      messages: [reviewTrigger],
      channel,
      runtime: {
        markCursorInFlight: () => {},
        clearInFlightCursor: () => {},
        markBatchProcessed: () => {},
        commitInFlightCursor: () => {},
      },
    });

    expect(handled).toBe(false);
    expect(sent).toHaveLength(0);
    expect(getAndyRequestByMessageId(reviewTrigger.id)).toBeUndefined();
    expect(listActiveAndyRequests(reviewTrigger.chat_jid)).toHaveLength(0);
  });

  it('does not create a fresh intake request for deferred replayed coordinator messages', async () => {
    const sent: string[] = [];
    const channel: Channel = {
      name: 'test',
      connect: async () => {},
      sendMessage: async (_jid, text) => {
        sent.push(text);
      },
      isConnected: () => true,
      ownsJid: () => true,
      disconnect: async () => {},
    };

    const replayedMessage: NewMessage = {
      id: 'deferred-user-msg-launchdeck-1',
      chat_jid: 'andy-developer@g.us',
      sender: 'nanoclaw-replay@nanoclaw',
      sender_name: 'nanoclaw-replay',
      content:
        '<andy_request_replay>{"request_id":"req-launchdeck-1","kind":"coordinator","original_message_id":"msg-launchdeck-1"}</andy_request_replay>\n@Andy build LaunchDeck',
      timestamp: '2026-03-17T11:00:00.000Z',
    };

    const handled = await handleAndyFrontdeskMessages({
      chatJid: replayedMessage.chat_jid,
      group: ANDY_GROUP,
      messages: [replayedMessage],
      channel,
      runtime: {
        markCursorInFlight: () => {},
        clearInFlightCursor: () => {},
        markBatchProcessed: () => {},
        commitInFlightCursor: () => {},
      },
    });

    expect(handled).toBe(false);
    expect(sent).toHaveLength(0);
    expect(getAndyRequestByMessageId(replayedMessage.id)).toBeUndefined();
    expect(listActiveAndyRequests(replayedMessage.chat_jid)).toHaveLength(0);
  });

  it('maps review triggers back to the existing tracked request', () => {
    createAndyRequestIfAbsent({
      request_id: 'req-review-2',
      chat_jid: 'andy-developer@g.us',
      source_group_folder: 'andy-developer',
      user_message_id: 'msg-user-review-2',
      user_prompt: 'ship the change',
      intent: 'work_intake',
      state: 'worker_review_requested',
    });

    const refs = getAndyRequestsForMessages([
      {
        id: 'msg-review-trigger-2',
        chat_jid: 'andy-developer@g.us',
        sender: 'nanoclaw-review@nanoclaw',
        sender_name: 'nanoclaw-review',
        content: `<review_request>
{
  "request_id": "req-review-2",
  "run_id": "run-review-2",
  "repo": "openclaw-gurusharan/nanoclaw",
  "branch": "jarvis-review-2",
  "worker_group_folder": "jarvis-worker-2"
}
</review_request>`,
        timestamp: '2026-03-07T10:11:00.000Z',
      },
    ]);

    expect(refs).toEqual([
      {
        requestId: 'req-review-2',
        messageId: 'msg-review-trigger-2',
        kind: 'review',
        isReplay: false,
      },
    ]);
  });

  it('prioritizes a coordinator request ahead of a newer review replay in mixed batches', () => {
    createAndyRequestIfAbsent({
      request_id: 'req-build-2',
      chat_jid: 'andy-developer@g.us',
      source_group_folder: 'andy-developer',
      user_message_id: 'msg-user-build-2',
      user_prompt: 'add a feature',
      intent: 'work_intake',
      state: 'queued_for_coordinator',
    });
    createAndyRequestIfAbsent({
      request_id: 'req-review-4',
      chat_jid: 'andy-developer@g.us',
      source_group_folder: 'andy-developer',
      user_message_id: 'msg-user-review-4',
      user_prompt: 'review the prior run',
      intent: 'work_intake',
      state: 'worker_review_requested',
    });

    const refs = getAndyRequestsForMessages([
      {
        id: 'msg-user-build-2',
        chat_jid: 'andy-developer@g.us',
        sender: 'uat-user@nanoclaw',
        sender_name: 'User',
        content: '@Andy add filter controls',
        timestamp: '2026-03-17T07:08:21.012Z',
      },
      {
        id: 'deferred-review-4',
        chat_jid: 'andy-developer@g.us',
        sender: 'nanoclaw-review@nanoclaw',
        sender_name: 'nanoclaw-review',
        content: buildAndyRequestReplayMessageContent({
          content: `<review_request>
{
  "request_id": "req-review-4",
  "run_id": "run-review-4",
  "repo": "openclaw-gurusharan/nanoclaw",
  "branch": "jarvis-review-4",
  "worker_group_folder": "jarvis-worker-1"
}
</review_request>`,
          requestId: 'req-review-4',
          kind: 'review',
          originalMessageId: 'msg-review-trigger-4',
        }),
        timestamp: '2026-03-17T07:08:22.743Z',
      },
    ]);

    expect(refs[0]).toMatchObject({
      requestId: 'req-build-2',
      kind: 'coordinator',
    });
    expect(refs[1]).toMatchObject({
      requestId: 'req-review-4',
      kind: 'review',
    });
  });

  it('prioritizes a fresh coordinator request ahead of a newer replayed coordinator message', () => {
    createAndyRequestIfAbsent({
      request_id: 'req-build-5',
      chat_jid: 'andy-developer@g.us',
      source_group_folder: 'andy-developer',
      user_message_id: 'msg-user-build-5',
      user_prompt: 'ship the follow-up',
      intent: 'work_intake',
      state: 'queued_for_coordinator',
    });
    createAndyRequestIfAbsent({
      request_id: 'req-build-4',
      chat_jid: 'andy-developer@g.us',
      source_group_folder: 'andy-developer',
      user_message_id: 'msg-user-build-4',
      user_prompt: 'older follow-up',
      intent: 'work_intake',
      state: 'queued_for_coordinator',
    });

    const refs = getAndyRequestsForMessages([
      {
        id: 'msg-user-build-5',
        chat_jid: 'andy-developer@g.us',
        sender: 'uat-user@nanoclaw',
        sender_name: 'User',
        content: '@Andy retry add feature',
        timestamp: '2026-03-17T07:18:14.235Z',
      },
      {
        id: 'deferred-user-build-4',
        chat_jid: 'andy-developer@g.us',
        sender: 'nanoclaw-replay@nanoclaw',
        sender_name: 'nanoclaw-replay',
        content: buildAndyRequestReplayMessageContent({
          content: '@Andy add feature',
          requestId: 'req-build-4',
          kind: 'coordinator',
          originalMessageId: 'msg-user-build-4',
        }),
        timestamp: '2026-03-17T07:18:16.527Z',
      },
    ]);

    expect(refs[0]).toMatchObject({
      requestId: 'req-build-5',
      kind: 'coordinator',
      isReplay: false,
    });
    expect(refs[1]).toMatchObject({
      requestId: 'req-build-4',
      kind: 'coordinator',
      isReplay: true,
    });
  });

  it('humanizes explicit review ownership states in status replies', () => {
    createAndyRequestIfAbsent({
      request_id: 'req-review-3',
      chat_jid: 'andy-developer@g.us',
      source_group_folder: 'andy-developer',
      user_message_id: 'msg-user-review-3',
      user_prompt: 'check the worker result',
      intent: 'work_intake',
      state: 'worker_review_requested',
    });
    updateAndyRequestState(
      'req-review-3',
      'andy_patch_in_progress',
      'Applying a small follow-up fix on the same branch',
    );

    const reply = buildAndyProgressStatusReply(
      'andy-developer@g.us',
      'req-review-3',
    );

    expect(reply).toContain('Andy is applying a bounded review patch');
    expect(reply).toContain('`andy_patch_in_progress`');
  });

  it('treats stale review backlog as non-active status work', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-07T10:00:00.000Z'));

    try {
      createAndyRequestIfAbsent({
        request_id: 'req-review-stale-1',
        chat_jid: 'andy-developer@g.us',
        source_group_folder: 'andy-developer',
        user_message_id: 'msg-user-review-stale-1',
        user_prompt: 'check the worker result',
        intent: 'work_intake',
        state: 'worker_review_requested',
      });

      vi.setSystemTime(new Date('2026-03-07T13:30:01.000Z'));

      const reply = buildAndyProgressStatusReply('andy-developer@g.us');

      expect(reply).toContain('No worker run is active right now');
      expect(reply).toContain('stale review request');
      expect(reply).toContain('older than 180m');
    } finally {
      vi.useRealTimers();
    }
  });

  it('marks stale request-id status replies as non-active work', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-07T10:00:00.000Z'));

    try {
      createAndyRequestIfAbsent({
        request_id: 'req-review-stale-2',
        chat_jid: 'andy-developer@g.us',
        source_group_folder: 'andy-developer',
        user_message_id: 'msg-user-review-stale-2',
        user_prompt: 'check the worker result',
        intent: 'work_intake',
        state: 'worker_review_requested',
      });

      vi.setSystemTime(new Date('2026-03-07T13:30:01.000Z'));

      const reply = buildAndyProgressStatusReply(
        'andy-developer@g.us',
        'req-review-stale-2',
      );

      expect(reply).toContain('worker_review_requested');
      expect(reply).toContain('not counted as active work');
    } finally {
      vi.useRealTimers();
    }
  });
});
