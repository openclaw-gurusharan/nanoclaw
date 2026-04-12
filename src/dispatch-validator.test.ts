import { describe, expect, it } from 'vitest';

import {
  parseCompletionContract,
  parseDispatchPayload,
  validateCompletionContract,
  validateDispatchPayload,
} from './dispatch-validator.js';

describe('dispatch-validator', () => {
  it('parses a raw dispatch JSON payload', () => {
    const payload = parseDispatchPayload(
      JSON.stringify({
        run_id: 'probe-jarvis-worker-1-1',
        task_type: 'test',
        input: 'Do the work',
        repo: 'openclaw-gurusharan/nanoclaw',
        branch: 'jarvis-probe-1',
        acceptance_tests: ['npm test'],
      }),
    );

    expect(payload?.run_id).toBe('probe-jarvis-worker-1-1');
    expect(validateDispatchPayload(payload).valid).toBe(true);
  });

  it('parses completion JSON inside completion tags', () => {
    const completion = parseCompletionContract(`
      some text
      <completion>
      {
        "run_id": "probe-jarvis-worker-1-1",
        "branch": "jarvis-probe-1",
        "commit_sha": "deadbeef",
        "files_changed": ["proof.txt"],
        "test_result": "ok",
        "risk": "low",
        "pr_skipped_reason": "probe"
      }
      </completion>
    `);

    expect(completion?.run_id).toBe('probe-jarvis-worker-1-1');
    expect(
      validateCompletionContract(completion, {
        expectedRunId: 'probe-jarvis-worker-1-1',
      }).valid,
    ).toBe(true);
  });

  it('rejects missing completion contract fields', () => {
    const completion = parseCompletionContract(`
      <completion>
      {"run_id":"probe-1","branch":"jarvis-probe"}
      </completion>
    `);
    const result = validateCompletionContract(completion, {
      expectedRunId: 'probe-1',
    });

    expect(result.valid).toBe(false);
    expect(result.missing).toContain('test_result');
    expect(result.missing).toContain('risk');
    expect(result.missing).toContain('pr_url or pr_skipped_reason');
  });
});
