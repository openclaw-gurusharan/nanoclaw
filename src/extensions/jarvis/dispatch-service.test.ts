import { beforeEach, describe, expect, it } from 'vitest';

import {
  _initTestDatabase,
  createAndyRequestIfAbsent,
  getAndyRequestById,
  insertWorkerRun,
  updateWorkerRunStatus,
} from '../../db.js';
import { recordBlockedDispatchAttempt } from './dispatch-service.js';

describe('recordBlockedDispatchAttempt', () => {
  beforeEach(() => {
    _initTestDatabase();
  });

  it('marks the request failed when request_id is present', () => {
    createAndyRequestIfAbsent({
      request_id: 'req-dispatch-block-explicit',
      chat_jid: 'andy-developer@g.us',
      source_group_folder: 'andy-developer',
      user_message_id: 'msg-dispatch-block-explicit',
      user_prompt: 'dispatch task',
      intent: 'work_intake',
      state: 'queued_for_coordinator',
    });

    recordBlockedDispatchAttempt({
      kind: 'dispatch_block',
      timestamp: '2026-03-08T00:00:00.000Z',
      source_group: 'andy-developer',
      target_jid: 'jarvis-worker-1@nanoclaw',
      target_folder: 'jarvis-worker-1',
      reason_code: 'invalid_dispatch_payload',
      reason_text: 'invalid dispatch payload: request_id missing',
      run_id: 'task-dispatch-block-explicit',
      request_id: 'req-dispatch-block-explicit',
    });

    const request = getAndyRequestById('req-dispatch-block-explicit');
    expect(request?.state).toBe('failed');
    expect(request?.last_status_text).toContain(
      'Dispatch blocked before worker queue',
    );
  });

  it('falls back to run_id when a blocked payload drops request_id', () => {
    createAndyRequestIfAbsent({
      request_id: 'req-dispatch-block-fallback',
      chat_jid: 'andy-developer@g.us',
      source_group_folder: 'andy-developer',
      user_message_id: 'msg-dispatch-block-fallback',
      user_prompt: 'dispatch task',
      intent: 'work_intake',
      state: 'queued_for_coordinator',
    });

    recordBlockedDispatchAttempt({
      kind: 'dispatch_block',
      timestamp: '2026-03-08T00:00:00.000Z',
      source_group: 'andy-developer',
      target_jid: 'jarvis-worker-1@nanoclaw',
      target_folder: 'jarvis-worker-1',
      reason_code: 'invalid_dispatch_payload',
      reason_text: 'invalid dispatch payload: request_id is required',
      run_id: 'req-dispatch-block-fallback',
    });

    const request = getAndyRequestById('req-dispatch-block-fallback');
    expect(request?.state).toBe('failed');
    expect(request?.last_status_text).toContain(
      'Dispatch blocked before worker queue',
    );
  });

  it('reconciles duplicate run_id blocks to the existing live worker run for the same request', () => {
    createAndyRequestIfAbsent({
      request_id: 'req-duplicate-live',
      chat_jid: 'andy-developer@g.us',
      source_group_folder: 'andy-developer',
      user_message_id: 'msg-duplicate-live',
      user_prompt: 'dispatch task',
      intent: 'work_intake',
      state: 'queued_for_coordinator',
    });
    insertWorkerRun('req-duplicate-live', 'jarvis-worker-1');
    updateWorkerRunStatus('req-duplicate-live', 'running');

    recordBlockedDispatchAttempt({
      kind: 'dispatch_block',
      timestamp: '2026-03-08T00:00:00.000Z',
      source_group: 'andy-developer',
      target_jid: 'jarvis-worker-1@nanoclaw',
      target_folder: 'jarvis-worker-1',
      reason_code: 'duplicate_run_id',
      reason_text:
        'duplicate run_id blocked: req-duplicate-live already running',
      run_id: 'req-duplicate-live',
      request_id: 'req-duplicate-live',
    });

    const request = getAndyRequestById('req-duplicate-live');
    expect(request?.worker_run_id).toBe('req-duplicate-live');
    expect(request?.worker_group_folder).toBe('jarvis-worker-1');
    expect(request?.state).toBe('worker_running');
    expect(request?.last_status_text).toContain(
      'Duplicate dispatch reconciled to existing running worker run.',
    );
  });
});
