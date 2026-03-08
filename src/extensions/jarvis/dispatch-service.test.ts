/**
 * Tests for dispatch-service.ts — the authoritative dispatch/completion contract surface.
 *
 * These tests validate that all dispatch payloads and completion contracts flow through
 * the single deterministic validator path in dispatch-validator.ts rather than ad hoc
 * text parsing spread across call sites.
 *
 * Source: https://github.com/ingpoc/nanoclaw/discussions/29
 */
import { beforeEach, describe, expect, it } from 'vitest';

import {
  _initTestDatabase,
  insertWorkerRun,
  updateWorkerRunStatus,
} from '../../db.js';
import type { RegisteredGroup } from '../../types.js';
import {
  buildDispatchBlockedMessage,
  canJarvisDispatchToTarget,
  normalizeWorkerDispatchPayloadText,
  queueAndyWorkerDispatchRun,
  validateAndyToWorkerPayload,
  validateAndyWorkerDispatchMessage,
} from './dispatch-service.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ANDY_GROUP: RegisteredGroup = {
  name: 'Andy Developer',
  folder: 'andy-developer',
  trigger: '@Andy',
  added_at: '2024-01-01T00:00:00.000Z',
};

const WORKER_GROUP: RegisteredGroup = {
  name: 'Jarvis Worker 1',
  folder: 'jarvis-worker-1',
  trigger: '',
  added_at: '2024-01-01T00:00:00.000Z',
};

function validPayloadText(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    run_id: 'jarvis-test-run-001',
    request_id: 'req-test-001',
    task_type: 'implement',
    context_intent: 'fresh',
    input: 'Implement the requested change',
    repo: 'ingpoc/nanoclaw',
    base_branch: 'main',
    branch: 'jarvis-test-feature',
    acceptance_tests: ['npm run build', 'npm test'],
    output_contract: {
      required_fields: [
        'run_id',
        'branch',
        'commit_sha',
        'files_changed',
        'test_result',
        'risk',
        'pr_url',
      ],
    },
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// canJarvisDispatchToTarget
// ---------------------------------------------------------------------------

describe('canJarvisDispatchToTarget', () => {
  it('allows main to dispatch to any target', () => {
    expect(canJarvisDispatchToTarget('other-group', true, WORKER_GROUP)).toBe(
      true,
    );
  });

  it('allows andy-developer to dispatch to jarvis-worker-*', () => {
    expect(
      canJarvisDispatchToTarget('andy-developer', false, WORKER_GROUP),
    ).toBe(true);
  });

  it('blocks non-andy non-main from dispatching to jarvis-worker-*', () => {
    const randomGroup: RegisteredGroup = {
      name: 'Random',
      folder: 'random-group',
      trigger: '',
      added_at: '2024-01-01T00:00:00.000Z',
    };
    expect(canJarvisDispatchToTarget('random-group', false, WORKER_GROUP)).toBe(
      false,
    );
  });

  it('allows dispatching to same group (self)', () => {
    expect(canJarvisDispatchToTarget('andy-developer', false, ANDY_GROUP)).toBe(
      true,
    );
  });

  it('returns false when targetGroup is undefined', () => {
    expect(canJarvisDispatchToTarget('andy-developer', false, undefined)).toBe(
      false,
    );
  });
});

// ---------------------------------------------------------------------------
// validateAndyToWorkerPayload — authoritative dispatch contract validator
// ---------------------------------------------------------------------------

describe('validateAndyToWorkerPayload — positive contract', () => {
  beforeEach(() => {
    _initTestDatabase();
  });

  it('accepts a fully valid dispatch payload', () => {
    const result = validateAndyToWorkerPayload(
      WORKER_GROUP.folder,
      validPayloadText(),
    );
    expect(result.valid).toBe(true);
  });

  it('accepts payload wrapped in surrounding text (JSON extraction)', () => {
    const text = `Here is the dispatch:\n${validPayloadText({ run_id: 'jarvis-wrap-001' })}\nEnd.`;
    const result = validateAndyToWorkerPayload(WORKER_GROUP.folder, text);
    expect(result.valid).toBe(true);
  });
});

describe('validateAndyToWorkerPayload — negative contract', () => {
  beforeEach(() => {
    _initTestDatabase();
  });

  it('rejects plain text (not a JSON dispatch payload)', () => {
    const result = validateAndyToWorkerPayload(
      WORKER_GROUP.folder,
      'please do the thing',
    );
    expect(result.valid).toBe(false);
    expect(result).toHaveProperty('reasonCode', 'invalid_dispatch_payload');
  });

  it('rejects payload missing run_id', () => {
    const payload = JSON.parse(validPayloadText());
    delete payload.run_id;
    const result = validateAndyToWorkerPayload(
      WORKER_GROUP.folder,
      JSON.stringify(payload),
    );
    expect(result.valid).toBe(false);
    expect(result).toHaveProperty('reasonCode', 'invalid_dispatch_payload');
  });

  it('rejects payload missing request_id', () => {
    const payload = JSON.parse(validPayloadText());
    delete payload.request_id;
    const result = validateAndyToWorkerPayload(
      WORKER_GROUP.folder,
      JSON.stringify(payload),
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toMatch(/request_id/);
    }
  });

  it('rejects payload with invalid task_type', () => {
    const result = validateAndyToWorkerPayload(
      WORKER_GROUP.folder,
      validPayloadText({ run_id: 'jarvis-tasktype-001', task_type: 'unknown' }),
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toMatch(/task_type/);
    }
  });

  it('rejects payload with branch that does not match jarvis-<feature>', () => {
    const result = validateAndyToWorkerPayload(
      WORKER_GROUP.folder,
      validPayloadText({ run_id: 'jarvis-branch-001', branch: 'main' }),
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toMatch(/branch/);
    }
  });

  it('rejects payload missing output_contract.required_fields', () => {
    const payload = JSON.parse(validPayloadText({ run_id: 'jarvis-oc-001' }));
    payload.output_contract = {};
    const result = validateAndyToWorkerPayload(
      WORKER_GROUP.folder,
      JSON.stringify(payload),
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toMatch(/required_fields/);
    }
  });

  it('blocks duplicate run_id that is already in a non-retryable status', () => {
    insertWorkerRun('jarvis-dup-001', WORKER_GROUP.folder);
    updateWorkerRunStatus('jarvis-dup-001', 'running');

    const result = validateAndyToWorkerPayload(
      WORKER_GROUP.folder,
      validPayloadText({ run_id: 'jarvis-dup-001' }),
    );
    expect(result.valid).toBe(false);
    expect(result).toHaveProperty('reasonCode', 'duplicate_run_id');
  });

  it('allows retry for run_id with failed status', () => {
    insertWorkerRun('jarvis-retry-001', WORKER_GROUP.folder);
    updateWorkerRunStatus('jarvis-retry-001', 'failed');

    const result = validateAndyToWorkerPayload(
      WORKER_GROUP.folder,
      validPayloadText({ run_id: 'jarvis-retry-001' }),
    );
    expect(result.valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// validateAndyWorkerDispatchMessage — message-level ownership gate
// ---------------------------------------------------------------------------

describe('validateAndyWorkerDispatchMessage', () => {
  beforeEach(() => {
    _initTestDatabase();
  });

  it('accepts andy-developer dispatching valid payload to jarvis-worker-*', () => {
    const result = validateAndyWorkerDispatchMessage(
      'andy-developer',
      WORKER_GROUP,
      validPayloadText({ run_id: 'jarvis-msg-001' }),
    );
    expect(result.valid).toBe(true);
  });

  it('blocks andy-developer self-dispatch (target is andy-developer)', () => {
    const result = validateAndyWorkerDispatchMessage(
      'andy-developer',
      ANDY_GROUP,
      validPayloadText({ run_id: 'jarvis-self-001' }),
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/andy-developer/);
  });

  it('blocks non-andy source dispatching JSON contract to jarvis-worker-*', () => {
    const result = validateAndyWorkerDispatchMessage(
      'other-group',
      WORKER_GROUP,
      validPayloadText({ run_id: 'jarvis-ownership-001' }),
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/ownership/);
  });

  it('allows non-andy source sending plain text to non-worker target', () => {
    const otherGroup: RegisteredGroup = {
      name: 'Other',
      folder: 'other-group',
      trigger: '',
      added_at: '2024-01-01T00:00:00.000Z',
    };
    const result = validateAndyWorkerDispatchMessage(
      'other-group',
      otherGroup,
      'hello there',
    );
    expect(result.valid).toBe(true);
  });

  it('blocks andy-developer invalid payload to jarvis-worker-*', () => {
    const result = validateAndyWorkerDispatchMessage(
      'andy-developer',
      WORKER_GROUP,
      validPayloadText({ run_id: 'jarvis-invalid-001', branch: 'not-jarvis' }),
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/branch/);
  });
});

// ---------------------------------------------------------------------------
// normalizeWorkerDispatchPayloadText — required_fields normalization
// ---------------------------------------------------------------------------

describe('normalizeWorkerDispatchPayloadText', () => {
  it('adds missing required fields to output_contract', () => {
    const payload = JSON.parse(validPayloadText());
    payload.output_contract.required_fields = ['run_id'];
    const text = JSON.stringify(payload);

    const { normalized, text: out } = normalizeWorkerDispatchPayloadText(
      'andy-developer',
      WORKER_GROUP,
      text,
    );

    expect(normalized).toBe(true);
    const parsed = JSON.parse(out);
    expect(parsed.output_contract.required_fields).toContain('branch');
    expect(parsed.output_contract.required_fields).toContain('commit_sha');
    expect(parsed.output_contract.required_fields).toContain('test_result');
    expect(parsed.output_contract.required_fields).toContain('risk');
    expect(parsed.output_contract.required_fields).toContain('pr_url');
  });

  it('returns unchanged text when source is not andy-developer', () => {
    const text = validPayloadText();
    const { normalized } = normalizeWorkerDispatchPayloadText(
      'other-group',
      WORKER_GROUP,
      text,
    );
    expect(normalized).toBe(false);
  });

  it('returns unchanged text when target is not jarvis-worker-*', () => {
    const text = validPayloadText();
    const { normalized } = normalizeWorkerDispatchPayloadText(
      'andy-developer',
      ANDY_GROUP,
      text,
    );
    expect(normalized).toBe(false);
  });

  it('returns unchanged text when already fully normalized', () => {
    const { normalized } = normalizeWorkerDispatchPayloadText(
      'andy-developer',
      WORKER_GROUP,
      validPayloadText(),
    );
    expect(normalized).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// queueAndyWorkerDispatchRun — run queuing with duplicate guard
// ---------------------------------------------------------------------------

describe('queueAndyWorkerDispatchRun', () => {
  beforeEach(() => {
    _initTestDatabase();
  });

  it('allows send and returns runId for a new valid dispatch', () => {
    const result = queueAndyWorkerDispatchRun(
      'andy-developer',
      WORKER_GROUP,
      validPayloadText({ run_id: 'jarvis-q-001' }),
    );
    expect(result.allowSend).toBe(true);
    expect(result.runId).toBe('jarvis-q-001');
    expect(result.queueState).toBe('new');
  });

  it('blocks duplicate run_id that is already non-retryable', () => {
    insertWorkerRun('jarvis-q-dup', WORKER_GROUP.folder);
    updateWorkerRunStatus('jarvis-q-dup', 'done');

    const result = queueAndyWorkerDispatchRun(
      'andy-developer',
      WORKER_GROUP,
      validPayloadText({ run_id: 'jarvis-q-dup' }),
    );
    expect(result.allowSend).toBe(false);
    expect(result.reason).toMatch(/duplicate/);
  });

  it('allows send for non-andy source (pass-through)', () => {
    const result = queueAndyWorkerDispatchRun(
      'other-group',
      WORKER_GROUP,
      validPayloadText({ run_id: 'jarvis-q-other' }),
    );
    expect(result.allowSend).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// buildDispatchBlockedMessage — message formatting for blocked events
// ---------------------------------------------------------------------------

describe('buildDispatchBlockedMessage', () => {
  it('includes run_id and reason for invalid_dispatch_payload', () => {
    const msg = buildDispatchBlockedMessage({
      kind: 'dispatch_block',
      timestamp: new Date().toISOString(),
      source_group: 'andy-developer',
      target_jid: 'jarvis-worker-1@g.us',
      target_folder: 'jarvis-worker-1',
      reason_code: 'invalid_dispatch_payload',
      reason_text: 'branch must match jarvis-<feature>',
      run_id: 'jarvis-blocked-001',
    });

    expect(msg).toContain('jarvis-blocked-001');
    expect(msg).toContain('branch');
  });

  it('includes duplicate run_id guidance for duplicate_run_id reason', () => {
    const msg = buildDispatchBlockedMessage({
      kind: 'dispatch_block',
      timestamp: new Date().toISOString(),
      source_group: 'andy-developer',
      target_jid: 'jarvis-worker-1@g.us',
      target_folder: 'jarvis-worker-1',
      reason_code: 'duplicate_run_id',
      reason_text: 'duplicate run_id blocked: jarvis-dup-001 already done',
      run_id: 'jarvis-dup-001',
    });

    expect(msg).toContain('duplicate');
    expect(msg).toContain('jarvis-dup-001');
    expect(msg).not.toContain('```json');
  });

  it('includes JSON template for invalid_dispatch_payload without run_id', () => {
    const msg = buildDispatchBlockedMessage({
      kind: 'dispatch_block',
      timestamp: new Date().toISOString(),
      source_group: 'andy-developer',
      target_jid: 'jarvis-worker-1@g.us',
      reason_code: 'invalid_dispatch_payload',
      reason_text: 'andy-developer -> jarvis-worker requires strict JSON',
    });

    expect(msg).toContain('```json');
    expect(msg).toContain('output_contract');
  });
});
