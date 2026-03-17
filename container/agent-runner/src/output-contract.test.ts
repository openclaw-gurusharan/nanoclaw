import { describe, expect, it } from 'vitest';

import { buildNoResultEventFailureOutput } from './output-contract.js';

describe('buildNoResultEventFailureOutput', () => {
  it('returns an explicit error when assistant text exists without a result event', () => {
    expect(
      buildNoResultEventFailureOutput({
        resultCount: 0,
        lastAssistantText: '  final completion text  ',
        newSessionId: 'sess-1',
        agentId: 'agent-1',
        agentType: 'worker',
      }),
    ).toEqual({
      status: 'error',
      result: null,
      newSessionId: 'sess-1',
      error:
        'Claude SDK emitted assistant text but no result event; refusing silent fallback. Assistant excerpt: final completion text',
      agentId: 'agent-1',
      agentType: 'worker',
    });
  });

  it('returns null when a real result event was emitted', () => {
    expect(
      buildNoResultEventFailureOutput({
        resultCount: 1,
        lastAssistantText: 'final completion text',
      }),
    ).toBeNull();
  });

  it('returns null when there is no assistant text to diagnose', () => {
    expect(
      buildNoResultEventFailureOutput({
        resultCount: 0,
        lastAssistantText: '   ',
      }),
    ).toBeNull();
  });
});
