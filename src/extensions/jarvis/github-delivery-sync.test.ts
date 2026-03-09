import { beforeEach, describe, expect, it } from 'vitest';

import {
  _initTestDatabase,
  insertWorkerRun,
  updateWorkerRunDispatchMetadata,
  updateWorkerRunStatus,
  getWorkerRun,
  type AndyRequestRecord,
} from '../../db.js';
import {
  buildDeliveryIssueBody,
  buildDeliveryIssueTitle,
  deriveDeliveryNextAction,
  deriveDeliveryWorkflowStatus,
  extractReferencedIssueNumber,
} from './github-delivery-sync.js';

function buildRequest(
  overrides: Partial<AndyRequestRecord> = {},
): AndyRequestRecord {
  return {
    request_id: 'req-delivery-1',
    chat_jid: 'andy-developer@g.us',
    source_group_folder: 'andy-developer',
    source_lane_id: 'andy-developer',
    user_message_id: 'msg-delivery-1',
    user_prompt: 'Implement automatic delivery board sync for Andy and Jarvis',
    intent: 'work_intake',
    state: 'queued_for_coordinator',
    worker_run_id: null,
    worker_group_folder: null,
    coordinator_session_id: null,
    last_status_text: null,
    github_issue_number: null,
    github_issue_url: null,
    github_issue_repo: null,
    github_project_board_key: null,
    github_project_item_id: null,
    created_at: '2026-03-08T00:00:00.000Z',
    updated_at: '2026-03-08T00:00:00.000Z',
    closed_at: null,
    ...overrides,
  };
}

describe('github-delivery-sync helpers', () => {
  beforeEach(() => {
    _initTestDatabase();
  });

  it('builds auto-created delivery issue content with metadata markers', () => {
    const request = buildRequest();

    expect(buildDeliveryIssueTitle(request.user_prompt)).toContain(
      '[Delivery]',
    );
    expect(buildDeliveryIssueBody(request)).toContain(
      '<!-- andy_request_id: req-delivery-1 -->',
    );
    expect(buildDeliveryIssueBody(request)).toContain('Andy/Jarvis Delivery');
  });

  it('extracts an explicitly referenced issue number from the user prompt', () => {
    expect(
      extractReferencedIssueNumber(
        'Use GitHub issue #46 as the single tracker for this request',
      ),
    ).toBe(46);
  });

  it('maps request states to delivery workflow statuses', () => {
    expect(
      deriveDeliveryWorkflowStatus(
        buildRequest({ state: 'queued_for_coordinator' }),
      ),
    ).toBe('Triage');
    expect(
      deriveDeliveryWorkflowStatus(
        buildRequest({ state: 'coordinator_active' }),
      ),
    ).toBe('Architecture');
    expect(
      deriveDeliveryWorkflowStatus(buildRequest({ state: 'worker_running' })),
    ).toBe('Worker Running');
    expect(
      deriveDeliveryWorkflowStatus(
        buildRequest({ state: 'worker_review_requested' }),
      ),
    ).toBe('Review');
    expect(
      deriveDeliveryWorkflowStatus(buildRequest({ state: 'completed' })),
    ).toBe('Done');
  });

  it('derives next action from active worker context', () => {
    insertWorkerRun('run-delivery-1', 'jarvis-worker-1');
    updateWorkerRunDispatchMetadata('run-delivery-1', {
      dispatch_repo: 'openclaw-gurusharan/nanoclaw',
      dispatch_branch: 'jarvis-delivery-sync',
      request_id: 'req-delivery-1',
      context_intent: 'fresh',
    });
    updateWorkerRunStatus('run-delivery-1', 'running');
    const run = getWorkerRun('run-delivery-1') ?? null;

    const nextAction = deriveDeliveryNextAction(
      buildRequest({
        state: 'worker_running',
        worker_run_id: 'run-delivery-1',
        worker_group_folder: 'jarvis-worker-1',
      }),
      run,
    );

    expect(nextAction).toContain('jarvis-worker-1');
    expect(nextAction).toContain('completion artifacts');
  });
});
