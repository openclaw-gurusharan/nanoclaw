import { describe, expect, it } from 'vitest';

import {
  isContainerTimeoutError,
  shouldRetryWorkerAgentFailure,
} from './worker-agent-error-policy.js';

describe('worker agent error policy', () => {
  it('detects no-output timeout errors', () => {
    expect(
      isContainerTimeoutError(
        'Container timed out (no_output_timeout after 420000ms)',
      ),
    ).toBe(true);
  });

  it('detects hard timeout errors', () => {
    expect(
      isContainerTimeoutError(
        'Container timed out (hard_timeout after 900000ms)',
      ),
    ).toBe(true);
  });

  it('ignores non-timeout errors', () => {
    expect(
      isContainerTimeoutError('opencode exited with code 1: network error'),
    ).toBe(false);
  });

  it('does not retry timed-out worker runs', () => {
    expect(
      shouldRetryWorkerAgentFailure({
        isWorkerRun: true,
        error: 'Container timed out (no_output_timeout after 420000ms)',
      }),
    ).toBe(false);
  });

  it('keeps retries enabled for non-worker failures', () => {
    expect(
      shouldRetryWorkerAgentFailure({
        isWorkerRun: false,
        error: 'Container timed out (no_output_timeout after 420000ms)',
      }),
    ).toBe(true);
  });

  it('keeps retries enabled for non-timeout worker errors', () => {
    expect(
      shouldRetryWorkerAgentFailure({
        isWorkerRun: true,
        error: 'Failed to spawn opencode: ENOENT',
      }),
    ).toBe(true);
  });
});
