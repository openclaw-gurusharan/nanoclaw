import { describe, expect, it } from 'vitest';

import {
  buildPlatformBranchName,
  buildPlatformRunContext,
  buildPlatformWorktreePath,
  extractPlatformBaseBranch,
  missingPlatformSections,
  selectCleanupCandidates,
  selectPlatformCandidate,
} from '../scripts/workflow/platform-loop.js';

describe('platform-loop helpers', () => {
  it('builds stable branch names', () => {
    expect(
      buildPlatformBranchName(42, 'Claude /loop adoption for platform'),
    ).toBe('claude-platform-42-claude-loop-adoption-for-platform');
  });

  it('builds request and run ids', () => {
    const context = buildPlatformRunContext(
      12,
      'Loop over another command',
      new Date('2026-03-08T10:20:30.000Z'),
    );

    expect(context).toEqual({
      requestId: 'platform-issue-12-20260308t102030z',
      runId: 'claude-platform-12-20260308t102030z',
      branch: 'claude-platform-12-loop-over-another-command',
    });
  });

  it('detects missing required platform sections', () => {
    expect(
      missingPlatformSections(
        '### Problem Statement\nX\n\n### Scope\nY\n\n### Acceptance Criteria\nZ\n',
      ),
    ).toEqual([
      'Expected Productivity Gain',
      'Base Branch',
      'Required Checks',
      'Required Evidence',
      'Blocked If',
    ]);
  });

  it('accepts issue-form headings with double hashes', () => {
    expect(
      missingPlatformSections(
        [
          '## Problem Statement',
          'X',
          '',
          '## Scope',
          'Y',
          '',
          '## Acceptance Criteria',
          'Z',
          '',
          '## Expected Productivity Gain',
          'Gain',
          '',
          '## Base Branch',
          'release/platform-pilot',
          '',
          '## Required Checks',
          '- npm run build',
          '',
          '## Required Evidence',
          '- linked PR',
          '',
          '## Blocked If',
          '- tests fail',
        ].join('\n'),
      ),
    ).toEqual([]);
  });

  it('extracts the issue base branch from issue-form sections', () => {
    expect(
      extractPlatformBaseBranch(
        [
          '## Problem Statement',
          'X',
          '',
          '## Base Branch',
          'release/platform-pilot',
        ].join('\n'),
      ),
    ).toBe('release/platform-pilot');
  });

  it('prefers review queue blocks before picking new work', () => {
    const result = selectPlatformCandidate([
      {
        number: 10,
        state: 'OPEN',
        status: 'Review',
        agent: 'claude',
        priority: 'p1',
        labels: [],
        missingSections: [],
      },
      {
        number: 11,
        state: 'OPEN',
        status: 'Ready',
        agent: '',
        priority: 'p0',
        labels: [],
        missingSections: [],
      },
    ]);

    expect(result).toEqual({
      action: 'noop',
      reason: 'review_queue_present',
      blockingIssueNumbers: [10],
    });
  });

  it('picks the highest-priority ready issue with full readiness sections', () => {
    const result = selectPlatformCandidate([
      {
        number: 22,
        title: 'Lower priority item',
        url: 'https://example.com/22',
        state: 'OPEN',
        status: 'Ready',
        agent: '',
        priority: 'p2',
        labels: [],
        missingSections: [],
        requestId: '',
        runId: '',
        nextDecision: '',
        baseBranch: 'main',
      },
      {
        number: 21,
        title: 'Adopt /loop over another command',
        url: 'https://example.com/21',
        state: 'OPEN',
        status: 'Ready',
        agent: '',
        priority: 'p0',
        labels: [],
        missingSections: [],
        requestId: '',
        runId: '',
        nextDecision: '',
        baseBranch: 'release/platform-pilot',
      },
    ]);

    expect(result).toEqual({
      action: 'pickup',
      issue: {
        number: 21,
        title: 'Adopt /loop over another command',
        url: 'https://example.com/21',
        status: 'Ready',
        agent: '',
        priority: 'p0',
        labels: [],
        missingSections: [],
        requestId: '',
        runId: '',
        nextDecision: '',
        baseBranch: 'release/platform-pilot',
        branch: 'claude-platform-21-adopt-loop-over-another-command',
        worktreePath: '.worktrees/platform-21',
      },
    });
  });

  it('ignores ready items assigned away from claude', () => {
    const result = selectPlatformCandidate([
      {
        number: 30,
        title: 'Human-owned item',
        url: 'https://example.com/30',
        state: 'OPEN',
        status: 'Ready',
        agent: 'human',
        priority: 'p0',
        labels: [],
        missingSections: [],
        requestId: '',
        runId: '',
        nextDecision: '',
        baseBranch: 'main',
      },
    ]);

    expect(result).toEqual({
      action: 'noop',
      reason: 'no_eligible_issue',
      candidatesChecked: [
        {
          number: 30,
          status: 'Ready',
          priority: 'p0',
          blocked: false,
          missingSections: [],
        },
      ],
    });
  });

  it('lists done claude-owned items for cleanup', () => {
    expect(
      selectCleanupCandidates([
        {
          number: 38,
          title: 'Structured outputs for dispatch',
          state: 'OPEN',
          status: 'Done',
          agent: 'claude',
        },
        {
          number: 39,
          title: 'Human-owned done item',
          state: 'OPEN',
          status: 'Done',
          agent: 'human',
        },
        {
          number: 40,
          title: 'Merged platform PR',
          state: 'CLOSED',
          status: 'Review',
          agent: 'claude',
        },
      ]),
    ).toEqual([
      {
        number: 38,
        title: 'Structured outputs for dispatch',
        status: 'Done',
        state: 'OPEN',
        branch: 'claude-platform-38-structured-outputs-for-dispatch',
        worktreePath: '.worktrees/platform-38',
      },
      {
        number: 40,
        title: 'Merged platform PR',
        status: 'Review',
        state: 'CLOSED',
        branch: 'claude-platform-40-merged-platform-pr',
        worktreePath: '.worktrees/platform-40',
      },
    ]);
  });

  it('builds stable per-issue worktree paths', () => {
    expect(buildPlatformWorktreePath(52)).toBe('.worktrees/platform-52');
  });
});
