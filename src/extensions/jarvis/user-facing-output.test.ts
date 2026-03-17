import { describe, expect, it } from 'vitest';

import { sanitizeUserFacingOutput } from './user-facing-output.js';
import { type RegisteredGroup } from '../../types.js';

const ANDY_GROUP: RegisteredGroup = {
  name: 'Andy Developer',
  folder: 'andy-developer',
  trigger: '@Andy',
  added_at: '2024-01-01T00:00:00.000Z',
};

const MAIN_GROUP: RegisteredGroup = {
  name: 'Main',
  folder: 'main',
  trigger: '@Andy',
  added_at: '2024-01-01T00:00:00.000Z',
};

const DISPATCH_PAYLOAD = JSON.stringify({
  run_id: 'task-launchdeck-ld01',
  request_id: 'req-launchdeck-ld01',
  task_type: 'implement',
  context_intent: 'fresh',
  input: 'Implement LaunchDeck LD-01',
  repo: 'openclaw-gurusharan/launchdeck',
  base_branch: 'main',
  branch: 'jarvis-nan-57-ld01-create-first-launch-project',
  acceptance_tests: ['npm run build'],
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
});

describe('sanitizeUserFacingOutput', () => {
  it('passes through non-Andy output unchanged', async () => {
    await expect(
      sanitizeUserFacingOutput(MAIN_GROUP, DISPATCH_PAYLOAD),
    ).resolves.toBe(DISPATCH_PAYLOAD);
  });

  it('renders dispatched only after worker linkage is confirmed', async () => {
    const text = await sanitizeUserFacingOutput(ANDY_GROUP, DISPATCH_PAYLOAD, {
      getRequestById: () => ({ worker_run_id: 'task-launchdeck-ld01' }) as any,
      getWorkerRunById: () => ({ run_id: 'task-launchdeck-ld01' }) as any,
      sleep: async () => {},
      timeoutMs: 1,
      pollIntervalMs: 1,
    });

    expect(text).toBe(
      'Dispatched `task-launchdeck-ld01` for `req-launchdeck-ld01` to `openclaw-gurusharan/launchdeck` on `jarvis-nan-57-ld01-create-first-launch-project` (implement).',
    );
  });

  it('falls back to truthful coordination text when dispatch is not confirmed', async () => {
    const text = await sanitizeUserFacingOutput(ANDY_GROUP, DISPATCH_PAYLOAD, {
      getRequestById: () => undefined,
      getWorkerRunById: () => undefined,
      sleep: async () => {},
      timeoutMs: 1,
      pollIntervalMs: 1,
    });

    expect(text).toBe(
      'Still coordinating `req-launchdeck-ld01`. Worker dispatch for `task-launchdeck-ld01` is not confirmed yet.',
    );
  });

  it('waits for delayed dispatch confirmation before telling the user it is dispatched', async () => {
    let attempts = 0;

    const text = await sanitizeUserFacingOutput(ANDY_GROUP, DISPATCH_PAYLOAD, {
      getRequestById: () => {
        attempts += 1;
        return attempts >= 2
          ? ({ worker_run_id: 'task-launchdeck-ld01' } as any)
          : undefined;
      },
      getWorkerRunById: () =>
        attempts >= 2 ? ({ run_id: 'task-launchdeck-ld01' } as any) : undefined,
      sleep: async () => {},
      timeoutMs: 5,
      pollIntervalMs: 1,
    });

    expect(text).toContain('Dispatched `task-launchdeck-ld01`');
    expect(attempts).toBeGreaterThanOrEqual(2);
  });

  it('neutralizes prose that claims dispatch without a confirmed worker run', async () => {
    const text = await sanitizeUserFacingOutput(
      ANDY_GROUP,
      '**Dispatched to jarvis-worker-1:** awaiting worker acceptance.',
    );

    expect(text).toBe(
      'Still coordinating worker dispatch. Acceptance is still being validated.',
    );
  });
});
