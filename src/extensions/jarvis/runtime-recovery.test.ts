import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  _initTestDatabase,
  createAndyRequestIfAbsent,
  completeWorkerRun,
  getUnprocessedMessages,
  insertWorkerRun,
  isMessageProcessed,
  getWorkerRun,
  updateWorkerRunStatus,
  getAndyRequestById,
  storeChatMetadata,
  storeMessage,
} from '../../db.js';
import type { RegisteredGroup } from '../../types.js';
import { hasRunningContainerWithPrefix } from '../../container-runtime.js';
import {
  recoverAndyReviewStateFromStoredMessages,
  recoverInterruptedWorkerDispatches,
  recoverPendingMessages,
  recoverTerminalWorkerDispatchMessages,
} from './runtime-recovery.js';

vi.mock('../../container-runtime.js', () => ({
  hasRunningContainerWithPrefix: vi.fn(() => false),
}));

const ANDY_GROUP: RegisteredGroup = {
  name: 'Andy Developer',
  folder: 'andy-developer',
  trigger: '@Andy',
  added_at: '2024-01-01T00:00:00.000Z',
};

describe('recoverAndyReviewStateFromStoredMessages', () => {
  beforeEach(() => {
    _initTestDatabase();
  });

  it('reconciles stale requests from stored Andy bot messages', () => {
    createAndyRequestIfAbsent({
      request_id: 'req-stale-1',
      chat_jid: 'andy-developer@g.us',
      source_group_folder: 'andy-developer',
      source_lane_id: 'andy-developer',
      user_message_id: 'user-msg-1',
      user_prompt: 'Run the pipeline probe.',
      intent: 'work_intake',
      state: 'coordinator_active',
    });

    storeChatMetadata(
      'andy-developer@g.us',
      '2026-03-16T12:03:09.000Z',
      'Andy Developer',
      'whatsapp',
      true,
    );

    storeMessage({
      id: 'bot-msg-1',
      chat_jid: 'andy-developer@g.us',
      sender: 'andy-developer@g.us',
      sender_name: 'Andy',
      content:
        'Andy: REVIEW: req-stale-1 — COMPLETED\n\nWorker pushed commit and Andy finished post-review work.',
      timestamp: '2026-03-16T12:03:09.000Z',
      is_from_me: true,
      is_bot_message: true,
    });

    recoverAndyReviewStateFromStoredMessages({
      registeredGroups: {
        'andy-developer@g.us': ANDY_GROUP,
      },
    });

    expect(getAndyRequestById('req-stale-1')).toMatchObject({
      request_id: 'req-stale-1',
      state: 'completed',
    });
  });
});

describe('recoverInterruptedWorkerDispatches', () => {
  beforeEach(() => {
    _initTestDatabase();
    vi.mocked(hasRunningContainerWithPrefix).mockReturnValue(false);
  });

  it('does not enqueue another replay message when an unprocessed dispatch already exists for the same run_id', () => {
    insertWorkerRun('run-replay-1', 'jarvis-worker-1', {
      dispatch_payload: JSON.stringify({
        run_id: 'run-replay-1',
        request_id: 'req-replay-1',
        task_type: 'code',
        context_intent: 'fresh',
        input: 'do work',
        repo: 'openclaw-gurusharan/aadhaar-chain',
        base_branch: 'main',
        branch: 'jarvis-run-replay-1',
        acceptance_tests: ['echo ok'],
        output_contract: { required_fields: ['run_id'] },
      }),
      dispatch_repo: 'openclaw-gurusharan/aadhaar-chain',
      dispatch_branch: 'jarvis-run-replay-1',
      request_id: 'req-replay-1',
      context_intent: 'fresh',
    });
    updateWorkerRunStatus('run-replay-1', 'running');

    storeChatMetadata(
      'jarvis-worker-1@nanoclaw',
      '2026-03-16T13:00:00.000Z',
      'Jarvis Worker 1',
      'nanoclaw',
      true,
    );
    storeMessage({
      id: 'existing-dispatch-1',
      chat_jid: 'jarvis-worker-1@nanoclaw',
      sender: 'nanoclaw-replay@nanoclaw',
      sender_name: 'nanoclaw-replay',
      content: JSON.stringify({
        run_id: 'run-replay-1',
        request_id: 'req-replay-1',
        task_type: 'code',
        context_intent: 'fresh',
        input: 'do work',
        repo: 'openclaw-gurusharan/aadhaar-chain',
        base_branch: 'main',
        branch: 'jarvis-run-replay-1',
        acceptance_tests: ['echo ok'],
        output_contract: { required_fields: ['run_id'] },
      }),
      timestamp: '2026-03-16T13:00:00.000Z',
      is_from_me: false,
      is_bot_message: false,
    });

    const queued: string[] = [];
    recoverInterruptedWorkerDispatches({
      registeredGroups: {
        'jarvis-worker-1@nanoclaw': {
          name: 'Jarvis Worker 1',
          folder: 'jarvis-worker-1',
          trigger: '@Jarvis',
          added_at: '2024-01-01T00:00:00.000Z',
        },
      },
      queue: {
        enqueueMessageCheck(chatJid: string) {
          queued.push(chatJid);
        },
      },
    });

    expect(queued).toEqual([]);
  });

  it('requeues a running worker run when the pending dispatch exists but no container is active', () => {
    insertWorkerRun('run-replay-2', 'jarvis-worker-1', {
      dispatch_payload: JSON.stringify({
        run_id: 'run-replay-2',
        request_id: 'req-replay-2',
        task_type: 'code',
        context_intent: 'fresh',
        input: 'do work',
        repo: 'openclaw-gurusharan/aadhaar-chain',
        base_branch: 'main',
        branch: 'jarvis-run-replay-2',
        acceptance_tests: ['echo ok'],
        output_contract: { required_fields: ['run_id'] },
      }),
      dispatch_repo: 'openclaw-gurusharan/aadhaar-chain',
      dispatch_branch: 'jarvis-run-replay-2',
      request_id: 'req-replay-2',
      context_intent: 'fresh',
    });
    updateWorkerRunStatus('run-replay-2', 'running');

    storeChatMetadata(
      'jarvis-worker-1@nanoclaw',
      '2026-03-16T13:00:00.000Z',
      'Jarvis Worker 1',
      'nanoclaw',
      true,
    );
    storeMessage({
      id: 'pending-dispatch-2',
      chat_jid: 'jarvis-worker-1@nanoclaw',
      sender: 'nanoclaw-replay@nanoclaw',
      sender_name: 'nanoclaw-replay',
      content: JSON.stringify({
        run_id: 'run-replay-2',
        request_id: 'req-replay-2',
        task_type: 'code',
        context_intent: 'fresh',
        input: 'do work',
        repo: 'openclaw-gurusharan/aadhaar-chain',
        base_branch: 'main',
        branch: 'jarvis-run-replay-2',
        acceptance_tests: ['echo ok'],
        output_contract: { required_fields: ['run_id'] },
      }),
      timestamp: '2026-03-16T13:00:00.000Z',
      is_from_me: false,
      is_bot_message: false,
    });

    recoverInterruptedWorkerDispatches({
      registeredGroups: {
        'jarvis-worker-1@nanoclaw': {
          name: 'Jarvis Worker 1',
          folder: 'jarvis-worker-1',
          trigger: '@Jarvis',
          added_at: '2024-01-01T00:00:00.000Z',
        },
      },
      queue: {
        enqueueMessageCheck() {
          throw new Error('should not enqueue a duplicate replay message');
        },
      },
    });

    expect(getWorkerRun('run-replay-2')).toMatchObject({
      run_id: 'run-replay-2',
      status: 'queued',
      phase: 'queued',
      recovered_from_reason: 'running_without_container_startup_replay',
    });
  });
});

describe('recoverPendingMessages', () => {
  beforeEach(() => {
    _initTestDatabase();
  });

  it('marks stale Andy intake messages processed when the linked request is already terminal', () => {
    createAndyRequestIfAbsent({
      request_id: 'req-terminal-andy-1',
      chat_jid: 'andy-developer@g.us',
      source_group_folder: 'andy-developer',
      source_lane_id: 'andy-developer',
      user_message_id: 'andy-user-msg-1',
      user_prompt: 'Run the probe again.',
      intent: 'work_intake',
      state: 'completed',
    });

    storeChatMetadata(
      'andy-developer@g.us',
      '2026-03-16T14:00:00.000Z',
      'Andy Developer',
      'whatsapp',
      true,
    );
    storeMessage({
      id: 'andy-user-msg-1',
      chat_jid: 'andy-developer@g.us',
      sender: 'user@g.us',
      sender_name: 'User',
      content: 'Run the probe again.',
      timestamp: '2026-03-16T14:00:00.000Z',
      is_from_me: false,
      is_bot_message: false,
    });

    const queue = {
      enqueueMessageCheck: vi.fn(),
    };

    recoverPendingMessages({
      registeredGroups: {
        'andy-developer@g.us': ANDY_GROUP,
      },
      lastAgentTimestamp: {},
      assistantName: 'Andy',
      queue,
    });

    expect(isMessageProcessed('andy-developer@g.us', 'andy-user-msg-1')).toBe(
      true,
    );
    expect(queue.enqueueMessageCheck).not.toHaveBeenCalled();
    expect(getUnprocessedMessages('andy-developer@g.us')).toHaveLength(0);
  });

  it('marks stale deferred Andy replay messages processed when the linked request is already terminal', () => {
    createAndyRequestIfAbsent({
      request_id: 'req-terminal-andy-replay-1',
      chat_jid: 'andy-developer@g.us',
      source_group_folder: 'andy-developer',
      source_lane_id: 'andy-developer',
      user_message_id: 'andy-user-msg-replay-original-1',
      user_prompt: 'Retry the probe again.',
      intent: 'work_intake',
      state: 'completed',
    });

    storeChatMetadata(
      'andy-developer@g.us',
      '2026-03-16T14:05:00.000Z',
      'Andy Developer',
      'whatsapp',
      true,
    );
    storeMessage({
      id: 'andy-user-msg-replay-1',
      chat_jid: 'andy-developer@g.us',
      sender: 'nanoclaw-replay@nanoclaw',
      sender_name: 'nanoclaw-replay',
      content:
        '<andy_request_replay>{"request_id":"req-terminal-andy-replay-1","kind":"coordinator","original_message_id":"andy-user-msg-replay-original-1"}</andy_request_replay>\nRun the probe again.',
      timestamp: '2026-03-16T14:05:00.000Z',
      is_from_me: false,
      is_bot_message: false,
    });

    const queue = {
      enqueueMessageCheck: vi.fn(),
    };

    recoverPendingMessages({
      registeredGroups: {
        'andy-developer@g.us': ANDY_GROUP,
      },
      lastAgentTimestamp: {},
      assistantName: 'Andy',
      queue,
    });

    expect(
      isMessageProcessed('andy-developer@g.us', 'andy-user-msg-replay-1'),
    ).toBe(true);
    expect(queue.enqueueMessageCheck).not.toHaveBeenCalled();
  });
});

describe('recoverTerminalWorkerDispatchMessages', () => {
  beforeEach(() => {
    _initTestDatabase();
  });

  it('marks stale dispatch messages processed when their worker run is already terminal', () => {
    insertWorkerRun('run-terminal-1', 'jarvis-worker-1', {
      dispatch_payload: JSON.stringify({
        run_id: 'run-terminal-1',
        request_id: 'req-terminal-1',
        task_type: 'code',
        context_intent: 'fresh',
        input: 'do work',
        repo: 'openclaw-gurusharan/aadhaar-chain',
        base_branch: 'main',
        branch: 'jarvis-run-terminal-1',
        acceptance_tests: ['echo ok'],
        output_contract: { required_fields: ['run_id'] },
      }),
      dispatch_repo: 'openclaw-gurusharan/aadhaar-chain',
      dispatch_branch: 'jarvis-run-terminal-1',
      request_id: 'req-terminal-1',
      context_intent: 'fresh',
    });
    completeWorkerRun('run-terminal-1', 'failed_timeout', 'timed out');

    storeChatMetadata(
      'jarvis-worker-1@nanoclaw',
      '2026-03-16T13:00:00.000Z',
      'Jarvis Worker 1',
      'nanoclaw',
      true,
    );
    storeMessage({
      id: 'stale-terminal-dispatch-1',
      chat_jid: 'jarvis-worker-1@nanoclaw',
      sender: 'nanoclaw-replay@nanoclaw',
      sender_name: 'nanoclaw-replay',
      content: JSON.stringify({
        run_id: 'run-terminal-1',
        request_id: 'req-terminal-1',
        task_type: 'code',
        context_intent: 'fresh',
        input: 'do work',
        repo: 'openclaw-gurusharan/aadhaar-chain',
        base_branch: 'main',
        branch: 'jarvis-run-terminal-1',
        acceptance_tests: ['echo ok'],
        output_contract: { required_fields: ['run_id'] },
      }),
      timestamp: '2026-03-16T13:00:00.000Z',
      is_from_me: false,
      is_bot_message: false,
    });

    recoverTerminalWorkerDispatchMessages({
      registeredGroups: {
        'jarvis-worker-1@nanoclaw': {
          name: 'Jarvis Worker 1',
          folder: 'jarvis-worker-1',
          trigger: '@Jarvis',
          added_at: '2024-01-01T00:00:00.000Z',
        },
      },
    });

    expect(
      isMessageProcessed(
        'jarvis-worker-1@nanoclaw',
        'stale-terminal-dispatch-1',
      ),
    ).toBe(true);
  });
});
