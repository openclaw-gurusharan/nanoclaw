import fs from 'fs';
import path from 'path';

import { describe, it, expect, beforeEach } from 'vitest';

import {
  _initTestDatabase,
  createTask,
  getAllTasks,
  getRegisteredGroup,
  getWorkerRun,
  insertWorkerRun,
  getProcessedMessageIds,
  isMessageProcessed,
  markMessageProcessed,
  markMessagesProcessed,
  getTaskById,
  setRegisteredGroup,
  updateWorkerRunCompletion,
  updateWorkerRunStatus,
} from './db.js';
import {
  canIpcAccessTarget,
  processTaskIpc,
  IpcDeps,
  queueAndyWorkerDispatchRun,
  validateAndyWorkerDispatchMessage,
} from './ipc.js';
import { RegisteredGroup } from './types.js';

// Set up registered groups used across tests
const MAIN_GROUP: RegisteredGroup = {
  name: 'Main',
  folder: 'main',
  trigger: 'always',
  added_at: '2024-01-01T00:00:00.000Z',
};

const OTHER_GROUP: RegisteredGroup = {
  name: 'Other',
  folder: 'other-group',
  trigger: '@Andy',
  added_at: '2024-01-01T00:00:00.000Z',
};

const THIRD_GROUP: RegisteredGroup = {
  name: 'Third',
  folder: 'third-group',
  trigger: '@Andy',
  added_at: '2024-01-01T00:00:00.000Z',
};

const ANDY_DEVELOPER_GROUP: RegisteredGroup = {
  name: 'Andy Developer',
  folder: 'andy-developer',
  trigger: '@Andy',
  added_at: '2024-01-01T00:00:00.000Z',
};

const JARVIS_WORKER_GROUP: RegisteredGroup = {
  name: 'Jarvis Worker 1',
  folder: 'jarvis-worker-1',
  trigger: '@jarvis',
  added_at: '2024-01-01T00:00:00.000Z',
};

const JARVIS_WORKER_2_GROUP: RegisteredGroup = {
  name: 'Jarvis Worker 2',
  folder: 'jarvis-worker-2',
  trigger: '@jarvis',
  added_at: '2024-01-01T00:00:00.000Z',
};

let groups: Record<string, RegisteredGroup>;
let deps: IpcDeps;
let sendMessageCalls: Array<{ jid: string; text: string; sourceGroup: string }>;
const IPC_ERRORS_DIR = path.join(process.cwd(), 'data', 'ipc', 'errors');

const VALID_WORKER_DISPATCH_PROMPT = JSON.stringify({
  run_id: 'run-20260223-001',
  task_type: 'implement',
  context_intent: 'fresh',
  input: 'Implement and validate the requested feature',
  repo: 'openclaw-gurusharan/nanoclaw',
  branch: 'jarvis-feature-dispatch-contract',
  acceptance_tests: ['npm run build', 'npm test'],
  output_contract: {
    required_fields: [
      'run_id',
      'branch',
      'commit_sha',
      'files_changed',
      'test_result',
      'risk',
      'pr_skipped_reason',
    ],
  },
});

beforeEach(() => {
  _initTestDatabase();
  fs.rmSync(IPC_ERRORS_DIR, { recursive: true, force: true });
  sendMessageCalls = [];

  groups = {
    'main@g.us': MAIN_GROUP,
    'other@g.us': OTHER_GROUP,
    'third@g.us': THIRD_GROUP,
    'andy@g.us': ANDY_DEVELOPER_GROUP,
    'jarvis-1@g.us': JARVIS_WORKER_GROUP,
    'jarvis-2@g.us': JARVIS_WORKER_2_GROUP,
  };

  // Populate DB as well
  setRegisteredGroup('main@g.us', MAIN_GROUP);
  setRegisteredGroup('other@g.us', OTHER_GROUP);
  setRegisteredGroup('third@g.us', THIRD_GROUP);
  setRegisteredGroup('andy@g.us', ANDY_DEVELOPER_GROUP);
  setRegisteredGroup('jarvis-1@g.us', JARVIS_WORKER_GROUP);
  setRegisteredGroup('jarvis-2@g.us', JARVIS_WORKER_2_GROUP);

  deps = {
    sendMessage: async (jid, text, sourceGroup) => {
      sendMessageCalls.push({ jid, text, sourceGroup });
    },
    registeredGroups: () => groups,
    registerGroup: (jid, group) => {
      groups[jid] = group;
      setRegisteredGroup(jid, group);
      // Mock the fs.mkdirSync that registerGroup does
    },
    syncGroupMetadata: async () => {},
    getAvailableGroups: () => [],
    writeGroupsSnapshot: () => {},
  };
});

// --- schedule_task authorization ---

describe('schedule_task authorization', () => {
  it('main group can schedule for another group', async () => {
    await processTaskIpc(
      {
        type: 'schedule_task',
        prompt: 'do something',
        schedule_type: 'once',
        schedule_value: '2025-06-01T00:00:00.000Z',
        targetJid: 'other@g.us',
      },
      'main',
      true,
      deps,
    );

    // Verify task was created in DB for the other group
    const allTasks = getAllTasks();
    expect(allTasks.length).toBe(1);
    expect(allTasks[0].group_folder).toBe('other-group');
  });

  it('non-main group can schedule for itself', async () => {
    await processTaskIpc(
      {
        type: 'schedule_task',
        prompt: 'self task',
        schedule_type: 'once',
        schedule_value: '2025-06-01T00:00:00.000Z',
        targetJid: 'other@g.us',
      },
      'other-group',
      false,
      deps,
    );

    const allTasks = getAllTasks();
    expect(allTasks.length).toBe(1);
    expect(allTasks[0].group_folder).toBe('other-group');
  });

  it('non-main group cannot schedule for another group', async () => {
    await processTaskIpc(
      {
        type: 'schedule_task',
        prompt: 'unauthorized',
        schedule_type: 'once',
        schedule_value: '2025-06-01T00:00:00.000Z',
        targetJid: 'main@g.us',
      },
      'other-group',
      false,
      deps,
    );

    const allTasks = getAllTasks();
    expect(allTasks.length).toBe(0);
  });

  it('andy-developer can schedule for jarvis-worker group', async () => {
    await processTaskIpc(
      {
        type: 'schedule_task',
        prompt: VALID_WORKER_DISPATCH_PROMPT,
        schedule_type: 'once',
        schedule_value: '2025-06-01T00:00:00.000Z',
        targetJid: 'jarvis-1@g.us',
      },
      'andy-developer',
      false,
      deps,
    );

    const allTasks = getAllTasks();
    expect(allTasks.length).toBe(1);
    expect(allTasks[0].group_folder).toBe('jarvis-worker-1');
  });

  it('main cannot schedule worker tasks and receives policy guidance', async () => {
    await processTaskIpc(
      {
        type: 'schedule_task',
        prompt: VALID_WORKER_DISPATCH_PROMPT,
        schedule_type: 'once',
        schedule_value: '2025-06-01T00:00:00.000Z',
        targetJid: 'jarvis-1@g.us',
      },
      'main',
      true,
      deps,
    );

    expect(getAllTasks()).toHaveLength(0);
    expect(sendMessageCalls).toHaveLength(1);
    expect(sendMessageCalls[0].jid).toBe('main@g.us');
    expect(sendMessageCalls[0].text).toContain('only andy-developer may schedule worker dispatch tasks');
    expect(sendMessageCalls[0].sourceGroup).toBe('nanoclaw-system');
  });

  it('andy-developer cannot schedule worker task with invalid dispatch payload', async () => {
    await processTaskIpc(
      {
        type: 'schedule_task',
        prompt: 'delegate to worker',
        schedule_type: 'once',
        schedule_value: '2025-06-01T00:00:00.000Z',
        targetJid: 'jarvis-1@g.us',
      },
      'andy-developer',
      false,
      deps,
    );

    const allTasks = getAllTasks();
    expect(allTasks.length).toBe(0);
    expect(sendMessageCalls).toHaveLength(1);
    expect(sendMessageCalls[0].jid).toBe('andy@g.us');
    expect(sendMessageCalls[0].text).toContain('requires strict JSON dispatch payload');
    expect(sendMessageCalls[0].sourceGroup).toBe('nanoclaw-system');
  });

  it('andy-developer receives payload validation errors for invalid worker dispatch JSON', async () => {
    const invalidDispatch = JSON.stringify({
      run_id: 'run-20260223-002',
      task_type: 'implement',
      context_intent: 'fresh',
      input: 'Implement and validate the requested feature',
      repo: 'openclaw-gurusharan/nanoclaw',
      branch: 'feature-invalid-branch',
      acceptance_tests: ['npm run build', 'npm test'],
      output_contract: {
        required_fields: [
          'run_id',
          'branch',
          'commit_sha',
          'files_changed',
          'test_result',
          'risk',
          'pr_skipped_reason',
        ],
      },
    });

    await processTaskIpc(
      {
        type: 'schedule_task',
        prompt: invalidDispatch,
        schedule_type: 'once',
        schedule_value: '2025-06-01T00:00:00.000Z',
        targetJid: 'jarvis-1@g.us',
      },
      'andy-developer',
      false,
      deps,
    );

    expect(getAllTasks()).toHaveLength(0);
    expect(sendMessageCalls).toHaveLength(1);
    expect(sendMessageCalls[0].jid).toBe('andy@g.us');
    expect(sendMessageCalls[0].text).toContain('branch must match jarvis-<feature>');
    expect(sendMessageCalls[0].sourceGroup).toBe('nanoclaw-system');
  });

  it('andy-developer duplicate worker schedule_task reports duplicate_run_id guidance (no resend template)', async () => {
    insertWorkerRun('run-20260223-duplicate-001', 'jarvis-worker-1');
    updateWorkerRunStatus('run-20260223-duplicate-001', 'review_requested');

    const duplicatePayload = JSON.stringify({
      run_id: 'run-20260223-duplicate-001',
      task_type: '',
      context_intent: '',
      input: '',
      repo: 'owner/repo',
      branch: 'jarvis-duplicate',
      acceptance_tests: [],
      output_contract: null,
    });

    await processTaskIpc(
      {
        type: 'schedule_task',
        prompt: duplicatePayload,
        schedule_type: 'once',
        schedule_value: '2025-06-01T00:00:00.000Z',
        targetJid: 'jarvis-1@g.us',
      },
      'andy-developer',
      false,
      deps,
    );

    expect(getAllTasks()).toHaveLength(0);
    expect(sendMessageCalls).toHaveLength(1);
    expect(sendMessageCalls[0].jid).toBe('andy@g.us');
    expect(sendMessageCalls[0].text).toContain('Dispatch ignored (duplicate run_id)');
    expect(sendMessageCalls[0].text).not.toContain('Fix: resend using the template below');
    expect(sendMessageCalls[0].sourceGroup).toBe('nanoclaw-system');
  });

  it('andy-developer cannot schedule for non-worker group', async () => {
    await processTaskIpc(
      {
        type: 'schedule_task',
        prompt: 'not allowed',
        schedule_type: 'once',
        schedule_value: '2025-06-01T00:00:00.000Z',
        targetJid: 'other@g.us',
      },
      'andy-developer',
      false,
      deps,
    );

    const allTasks = getAllTasks();
    expect(allTasks.length).toBe(0);
  });

  it('rejects schedule_task for unregistered target JID', async () => {
    await processTaskIpc(
      {
        type: 'schedule_task',
        prompt: 'no target',
        schedule_type: 'once',
        schedule_value: '2025-06-01T00:00:00.000Z',
        targetJid: 'unknown@g.us',
      },
      'main',
      true,
      deps,
    );

    const allTasks = getAllTasks();
    expect(allTasks.length).toBe(0);
  });
});

// --- pause_task authorization ---

describe('pause_task authorization', () => {
  beforeEach(() => {
    createTask({
      id: 'task-main',
      group_folder: 'main',
      chat_jid: 'main@g.us',
      prompt: 'main task',
      schedule_type: 'once',
      schedule_value: '2025-06-01T00:00:00.000Z',
      context_mode: 'isolated',
      next_run: '2025-06-01T00:00:00.000Z',
      status: 'active',
      created_at: '2024-01-01T00:00:00.000Z',
    });
    createTask({
      id: 'task-other',
      group_folder: 'other-group',
      chat_jid: 'other@g.us',
      prompt: 'other task',
      schedule_type: 'once',
      schedule_value: '2025-06-01T00:00:00.000Z',
      context_mode: 'isolated',
      next_run: '2025-06-01T00:00:00.000Z',
      status: 'active',
      created_at: '2024-01-01T00:00:00.000Z',
    });
  });

  it('main group can pause any task', async () => {
    await processTaskIpc(
      { type: 'pause_task', taskId: 'task-other' },
      'main',
      true,
      deps,
    );
    expect(getTaskById('task-other')!.status).toBe('paused');
  });

  it('non-main group can pause its own task', async () => {
    await processTaskIpc(
      { type: 'pause_task', taskId: 'task-other' },
      'other-group',
      false,
      deps,
    );
    expect(getTaskById('task-other')!.status).toBe('paused');
  });

  it('andy-developer can pause jarvis worker task', async () => {
    createTask({
      id: 'task-worker',
      group_folder: 'jarvis-worker-1',
      chat_jid: 'jarvis-1@g.us',
      prompt: 'worker task',
      schedule_type: 'once',
      schedule_value: '2025-06-01T00:00:00.000Z',
      context_mode: 'isolated',
      next_run: '2025-06-01T00:00:00.000Z',
      status: 'active',
      created_at: '2024-01-01T00:00:00.000Z',
    });

    await processTaskIpc({ type: 'pause_task', taskId: 'task-worker' }, 'andy-developer', false, deps);
    expect(getTaskById('task-worker')!.status).toBe('paused');
  });

  it('non-main group cannot pause another groups task', async () => {
    await processTaskIpc(
      { type: 'pause_task', taskId: 'task-main' },
      'other-group',
      false,
      deps,
    );
    expect(getTaskById('task-main')!.status).toBe('active');
  });
});

// --- resume_task authorization ---

describe('resume_task authorization', () => {
  beforeEach(() => {
    createTask({
      id: 'task-paused',
      group_folder: 'other-group',
      chat_jid: 'other@g.us',
      prompt: 'paused task',
      schedule_type: 'once',
      schedule_value: '2025-06-01T00:00:00.000Z',
      context_mode: 'isolated',
      next_run: '2025-06-01T00:00:00.000Z',
      status: 'paused',
      created_at: '2024-01-01T00:00:00.000Z',
    });
  });

  it('main group can resume any task', async () => {
    await processTaskIpc(
      { type: 'resume_task', taskId: 'task-paused' },
      'main',
      true,
      deps,
    );
    expect(getTaskById('task-paused')!.status).toBe('active');
  });

  it('non-main group can resume its own task', async () => {
    await processTaskIpc(
      { type: 'resume_task', taskId: 'task-paused' },
      'other-group',
      false,
      deps,
    );
    expect(getTaskById('task-paused')!.status).toBe('active');
  });

  it('andy-developer can resume jarvis worker task', async () => {
    createTask({
      id: 'task-worker-paused',
      group_folder: 'jarvis-worker-1',
      chat_jid: 'jarvis-1@g.us',
      prompt: 'worker paused task',
      schedule_type: 'once',
      schedule_value: '2025-06-01T00:00:00.000Z',
      context_mode: 'isolated',
      next_run: '2025-06-01T00:00:00.000Z',
      status: 'paused',
      created_at: '2024-01-01T00:00:00.000Z',
    });

    await processTaskIpc({ type: 'resume_task', taskId: 'task-worker-paused' }, 'andy-developer', false, deps);
    expect(getTaskById('task-worker-paused')!.status).toBe('active');
  });

  it('non-main group cannot resume another groups task', async () => {
    await processTaskIpc(
      { type: 'resume_task', taskId: 'task-paused' },
      'third-group',
      false,
      deps,
    );
    expect(getTaskById('task-paused')!.status).toBe('paused');
  });
});

// --- cancel_task authorization ---

describe('cancel_task authorization', () => {
  it('main group can cancel any task', async () => {
    createTask({
      id: 'task-to-cancel',
      group_folder: 'other-group',
      chat_jid: 'other@g.us',
      prompt: 'cancel me',
      schedule_type: 'once',
      schedule_value: '2025-06-01T00:00:00.000Z',
      context_mode: 'isolated',
      next_run: null,
      status: 'active',
      created_at: '2024-01-01T00:00:00.000Z',
    });

    await processTaskIpc(
      { type: 'cancel_task', taskId: 'task-to-cancel' },
      'main',
      true,
      deps,
    );
    expect(getTaskById('task-to-cancel')).toBeUndefined();
  });

  it('non-main group can cancel its own task', async () => {
    createTask({
      id: 'task-own',
      group_folder: 'other-group',
      chat_jid: 'other@g.us',
      prompt: 'my task',
      schedule_type: 'once',
      schedule_value: '2025-06-01T00:00:00.000Z',
      context_mode: 'isolated',
      next_run: null,
      status: 'active',
      created_at: '2024-01-01T00:00:00.000Z',
    });

    await processTaskIpc(
      { type: 'cancel_task', taskId: 'task-own' },
      'other-group',
      false,
      deps,
    );
    expect(getTaskById('task-own')).toBeUndefined();
  });

  it('andy-developer can cancel jarvis worker task', async () => {
    createTask({
      id: 'task-worker-cancel',
      group_folder: 'jarvis-worker-1',
      chat_jid: 'jarvis-1@g.us',
      prompt: 'cancel worker',
      schedule_type: 'once',
      schedule_value: '2025-06-01T00:00:00.000Z',
      context_mode: 'isolated',
      next_run: null,
      status: 'active',
      created_at: '2024-01-01T00:00:00.000Z',
    });

    await processTaskIpc({ type: 'cancel_task', taskId: 'task-worker-cancel' }, 'andy-developer', false, deps);
    expect(getTaskById('task-worker-cancel')).toBeUndefined();
  });

  it('non-main group cannot cancel another groups task', async () => {
    createTask({
      id: 'task-foreign',
      group_folder: 'main',
      chat_jid: 'main@g.us',
      prompt: 'not yours',
      schedule_type: 'once',
      schedule_value: '2025-06-01T00:00:00.000Z',
      context_mode: 'isolated',
      next_run: null,
      status: 'active',
      created_at: '2024-01-01T00:00:00.000Z',
    });

    await processTaskIpc(
      { type: 'cancel_task', taskId: 'task-foreign' },
      'other-group',
      false,
      deps,
    );
    expect(getTaskById('task-foreign')).toBeDefined();
  });
});

// --- register_group authorization ---

describe('register_group authorization', () => {
  it('non-main group cannot register a group', async () => {
    await processTaskIpc(
      {
        type: 'register_group',
        jid: 'new@g.us',
        name: 'New Group',
        folder: 'new-group',
        trigger: '@Andy',
      },
      'other-group',
      false,
      deps,
    );

    // registeredGroups should not have changed
    expect(groups['new@g.us']).toBeUndefined();
  });

  it('main group cannot register with unsafe folder path', async () => {
    await processTaskIpc(
      {
        type: 'register_group',
        jid: 'new@g.us',
        name: 'New Group',
        folder: '../../outside',
        trigger: '@Andy',
      },
      'main',
      true,
      deps,
    );

    expect(groups['new@g.us']).toBeUndefined();
  });
});

// --- refresh_groups authorization ---

describe('refresh_groups authorization', () => {
  it('non-main group cannot trigger refresh', async () => {
    // This should be silently blocked (no crash, no effect)
    await processTaskIpc(
      { type: 'refresh_groups' },
      'other-group',
      false,
      deps,
    );
    // If we got here without error, the auth gate worked
  });
});

// --- IPC message authorization ---
// Tests the authorization pattern from startIpcWatcher (ipc.ts).
// The logic: isMain || (targetGroup && targetGroup.folder === sourceGroup)

describe('IPC message authorization', () => {
  function isMessageAuthorized(sourceGroup: string, isMain: boolean, targetChatJid: string): boolean {
    const targetGroup = groups[targetChatJid];
    return canIpcAccessTarget(sourceGroup, isMain, targetGroup);
  }

  it('main group can send to any group', () => {
    expect(isMessageAuthorized('main', true, 'other@g.us')).toBe(true);
    expect(isMessageAuthorized('main', true, 'third@g.us')).toBe(true);
  });

  it('non-main group can send to its own chat', () => {
    expect(isMessageAuthorized('other-group', false, 'other@g.us')).toBe(true);
  });

  it('non-main group cannot send to another groups chat', () => {
    expect(isMessageAuthorized('other-group', false, 'main@g.us')).toBe(false);
    expect(isMessageAuthorized('other-group', false, 'third@g.us')).toBe(false);
  });

  it('non-main group cannot send to unregistered JID', () => {
    expect(isMessageAuthorized('other-group', false, 'unknown@g.us')).toBe(false);
  });

  it('main group can send to unregistered JID', () => {
    // Main is always authorized regardless of target
    expect(isMessageAuthorized('main', true, 'unknown@g.us')).toBe(true);
  });

  it('andy-developer can send to jarvis worker', () => {
    expect(isMessageAuthorized('andy-developer', false, 'jarvis-1@g.us')).toBe(true);
  });

  it('andy-developer cannot send to non-worker groups', () => {
    expect(isMessageAuthorized('andy-developer', false, 'other@g.us')).toBe(false);
    expect(isMessageAuthorized('andy-developer', false, 'main@g.us')).toBe(false);
  });
});

describe('andy worker dispatch payload guardrails', () => {
  it('blocks worker-style JSON dispatch accidentally targeted to andy-developer chat', () => {
    const result = validateAndyWorkerDispatchMessage(
      'andy-developer',
      groups['andy@g.us'],
      VALID_WORKER_DISPATCH_PROMPT,
    );

    expect(result.valid).toBe(false);
    expect(result.reason).toContain('dispatch payload to andy-developer chat blocked');
  });

  it('allows andy-developer plain status messages to its own chat', () => {
    const result = validateAndyWorkerDispatchMessage(
      'andy-developer',
      groups['andy@g.us'],
      'Jarvis workers are running; I will report status shortly.',
    );

    expect(result.valid).toBe(true);
  });

  it('allows valid strict dispatch JSON when target is jarvis-worker group', () => {
    const result = validateAndyWorkerDispatchMessage(
      'andy-developer',
      groups['jarvis-1@g.us'],
      VALID_WORKER_DISPATCH_PROMPT,
    );

    expect(result.valid).toBe(true);
  });

  it('blocks malformed replay dispatch as duplicate when run_id already completed', () => {
    insertWorkerRun('run-20260223-replay-001', 'jarvis-worker-2');
    updateWorkerRunStatus('run-20260223-replay-001', 'review_requested');

    const malformedReplay = JSON.stringify({
      run_id: 'run-20260223-replay-001',
      task_type: '',
      context_intent: '',
      input: '',
      repo: 'owner/repo',
      branch: 'jarvis-replay',
      acceptance_tests: [],
      output_contract: null,
    });

    const result = validateAndyWorkerDispatchMessage(
      'andy-developer',
      groups['jarvis-2@g.us'],
      malformedReplay,
    );

    expect(result.valid).toBe(false);
    expect(result.reason).toContain('duplicate run_id blocked');
    expect(result.reason).toContain('already review_requested');
  });

  it('blocks continue dispatch when no reusable session exists for worker/repo/branch', () => {
    const payload = JSON.stringify({
      run_id: 'run-20260223-continue-001',
      task_type: 'fix',
      context_intent: 'continue',
      input: 'Continue fixing the same branch task',
      repo: 'openclaw-gurusharan/nanoclaw',
      branch: 'jarvis-feature-dispatch-contract',
      acceptance_tests: ['npm run build'],
      output_contract: {
        required_fields: [
          'run_id',
          'branch',
          'commit_sha',
          'files_changed',
          'test_result',
          'risk',
          'pr_skipped_reason',
          'session_id',
        ],
      },
    });
    const result = validateAndyWorkerDispatchMessage(
      'andy-developer',
      groups['jarvis-1@g.us'],
      payload,
    );

    expect(result.valid).toBe(false);
    expect(result.reason).toContain('context_intent=continue requires a reusable prior session');
  });

  it('blocks continue dispatch when explicit session_id belongs to another worker lane', () => {
    insertWorkerRun('run-session-owner', 'jarvis-worker-1', {
      dispatch_repo: 'openclaw-gurusharan/nanoclaw',
      dispatch_branch: 'jarvis-feature-dispatch-contract',
      context_intent: 'continue',
    });
    updateWorkerRunCompletion('run-session-owner', {
      effective_session_id: 'sess-owned-by-worker-1',
    });
    updateWorkerRunStatus('run-session-owner', 'review_requested');

    const payload = JSON.stringify({
      run_id: 'run-20260223-continue-002',
      task_type: 'fix',
      context_intent: 'continue',
      session_id: 'sess-owned-by-worker-1',
      input: 'Continue with the same session',
      repo: 'openclaw-gurusharan/nanoclaw',
      branch: 'jarvis-feature-dispatch-contract',
      acceptance_tests: ['npm run build'],
      output_contract: {
        required_fields: [
          'run_id',
          'branch',
          'commit_sha',
          'files_changed',
          'test_result',
          'risk',
          'pr_skipped_reason',
          'session_id',
        ],
      },
    });
    const result = validateAndyWorkerDispatchMessage(
      'andy-developer',
      groups['jarvis-2@g.us'],
      payload,
    );

    expect(result.valid).toBe(false);
    expect(result.reason).toContain('cross-worker session reuse is blocked');
  });

  it('allows continue dispatch when reusable session exists for same worker/repo/branch', () => {
    insertWorkerRun('run-session-reusable', 'jarvis-worker-1', {
      dispatch_repo: 'openclaw-gurusharan/nanoclaw',
      dispatch_branch: 'jarvis-feature-dispatch-contract',
      context_intent: 'continue',
    });
    updateWorkerRunCompletion('run-session-reusable', {
      effective_session_id: 'sess-reuse-1',
    });
    updateWorkerRunStatus('run-session-reusable', 'review_requested');

    const payload = JSON.stringify({
      run_id: 'run-20260223-continue-003',
      task_type: 'fix',
      context_intent: 'continue',
      input: 'Continue with recent context',
      repo: 'openclaw-gurusharan/nanoclaw',
      branch: 'jarvis-feature-dispatch-contract',
      acceptance_tests: ['npm run build'],
      output_contract: {
        required_fields: [
          'run_id',
          'branch',
          'commit_sha',
          'files_changed',
          'test_result',
          'risk',
          'pr_skipped_reason',
          'session_id',
        ],
      },
    });
    const result = validateAndyWorkerDispatchMessage(
      'andy-developer',
      groups['jarvis-1@g.us'],
      payload,
    );

    expect(result.valid).toBe(true);
  });

  it('blocks strict worker dispatch JSON from non-andy source lanes', () => {
    const result = validateAndyWorkerDispatchMessage(
      'main',
      groups['jarvis-1@g.us'],
      VALID_WORKER_DISPATCH_PROMPT,
    );

    expect(result.valid).toBe(false);
    expect(result.reason).toContain('worker dispatch ownership violation');
  });
});

describe('andy worker dispatch run queueing', () => {
  it('queues a new worker run when dispatch is valid', () => {
    const decision = queueAndyWorkerDispatchRun(
      'andy-developer',
      groups['jarvis-1@g.us'],
      VALID_WORKER_DISPATCH_PROMPT,
    );

    expect(decision.allowSend).toBe(true);
    expect(decision.queueState).toBe('new');
    expect(decision.runId).toBe('run-20260223-001');
    const row = getWorkerRun('run-20260223-001');
    expect(row?.status).toBe('queued');
    expect(row?.context_intent).toBe('fresh');
    expect(row?.session_selection_source).toBe('new');
  });

  it('blocks duplicate run_id dispatch', () => {
    const first = queueAndyWorkerDispatchRun(
      'andy-developer',
      groups['jarvis-1@g.us'],
      VALID_WORKER_DISPATCH_PROMPT,
    );
    const second = queueAndyWorkerDispatchRun(
      'andy-developer',
      groups['jarvis-1@g.us'],
      VALID_WORKER_DISPATCH_PROMPT,
    );

    expect(first.allowSend).toBe(true);
    expect(second.allowSend).toBe(false);
    expect(second.reason).toContain('duplicate run_id');
  });

  it('allows retry for failed_contract run_id', () => {
    queueAndyWorkerDispatchRun(
      'andy-developer',
      groups['jarvis-1@g.us'],
      VALID_WORKER_DISPATCH_PROMPT,
    );
    updateWorkerRunStatus('run-20260223-001', 'failed_contract');

    const retry = queueAndyWorkerDispatchRun(
      'andy-developer',
      groups['jarvis-1@g.us'],
      VALID_WORKER_DISPATCH_PROMPT,
    );

    const row = getWorkerRun('run-20260223-001');
    expect(retry.allowSend).toBe(true);
    expect(retry.queueState).toBe('retry');
    expect(row?.status).toBe('queued');
    expect(row?.retry_count).toBe(1);
  });
});

// --- schedule_task with cron and interval types ---

describe('schedule_task schedule types', () => {
  it('creates task with cron schedule and computes next_run', async () => {
    await processTaskIpc(
      {
        type: 'schedule_task',
        prompt: 'cron task',
        schedule_type: 'cron',
        schedule_value: '0 9 * * *', // every day at 9am
        targetJid: 'other@g.us',
      },
      'main',
      true,
      deps,
    );

    const tasks = getAllTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].schedule_type).toBe('cron');
    expect(tasks[0].next_run).toBeTruthy();
    // next_run should be a valid ISO date in the future
    expect(new Date(tasks[0].next_run!).getTime()).toBeGreaterThan(
      Date.now() - 60000,
    );
  });

  it('rejects invalid cron expression', async () => {
    await processTaskIpc(
      {
        type: 'schedule_task',
        prompt: 'bad cron',
        schedule_type: 'cron',
        schedule_value: 'not a cron',
        targetJid: 'other@g.us',
      },
      'main',
      true,
      deps,
    );

    expect(getAllTasks()).toHaveLength(0);
  });

  it('creates task with interval schedule', async () => {
    const before = Date.now();

    await processTaskIpc(
      {
        type: 'schedule_task',
        prompt: 'interval task',
        schedule_type: 'interval',
        schedule_value: '3600000', // 1 hour
        targetJid: 'other@g.us',
      },
      'main',
      true,
      deps,
    );

    const tasks = getAllTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].schedule_type).toBe('interval');
    // next_run should be ~1 hour from now
    const nextRun = new Date(tasks[0].next_run!).getTime();
    expect(nextRun).toBeGreaterThanOrEqual(before + 3600000 - 1000);
    expect(nextRun).toBeLessThanOrEqual(Date.now() + 3600000 + 1000);
  });

  it('rejects invalid interval (non-numeric)', async () => {
    await processTaskIpc(
      {
        type: 'schedule_task',
        prompt: 'bad interval',
        schedule_type: 'interval',
        schedule_value: 'abc',
        targetJid: 'other@g.us',
      },
      'main',
      true,
      deps,
    );

    expect(getAllTasks()).toHaveLength(0);
  });

  it('rejects invalid interval (zero)', async () => {
    await processTaskIpc(
      {
        type: 'schedule_task',
        prompt: 'zero interval',
        schedule_type: 'interval',
        schedule_value: '0',
        targetJid: 'other@g.us',
      },
      'main',
      true,
      deps,
    );

    expect(getAllTasks()).toHaveLength(0);
  });

  it('rejects invalid once timestamp', async () => {
    await processTaskIpc(
      {
        type: 'schedule_task',
        prompt: 'bad once',
        schedule_type: 'once',
        schedule_value: 'not-a-date',
        targetJid: 'other@g.us',
      },
      'main',
      true,
      deps,
    );

    expect(getAllTasks()).toHaveLength(0);
  });
});

// --- context_mode defaulting ---

describe('schedule_task context_mode', () => {
  it('accepts context_mode=group', async () => {
    await processTaskIpc(
      {
        type: 'schedule_task',
        prompt: 'group context',
        schedule_type: 'once',
        schedule_value: '2025-06-01T00:00:00.000Z',
        context_mode: 'group',
        targetJid: 'other@g.us',
      },
      'main',
      true,
      deps,
    );

    const tasks = getAllTasks();
    expect(tasks[0].context_mode).toBe('group');
  });

  it('accepts context_mode=isolated', async () => {
    await processTaskIpc(
      {
        type: 'schedule_task',
        prompt: 'isolated context',
        schedule_type: 'once',
        schedule_value: '2025-06-01T00:00:00.000Z',
        context_mode: 'isolated',
        targetJid: 'other@g.us',
      },
      'main',
      true,
      deps,
    );

    const tasks = getAllTasks();
    expect(tasks[0].context_mode).toBe('isolated');
  });

  it('defaults invalid context_mode to isolated', async () => {
    await processTaskIpc(
      {
        type: 'schedule_task',
        prompt: 'bad context',
        schedule_type: 'once',
        schedule_value: '2025-06-01T00:00:00.000Z',
        context_mode: 'bogus' as any,
        targetJid: 'other@g.us',
      },
      'main',
      true,
      deps,
    );

    const tasks = getAllTasks();
    expect(tasks[0].context_mode).toBe('isolated');
  });

  it('defaults missing context_mode to isolated', async () => {
    await processTaskIpc(
      {
        type: 'schedule_task',
        prompt: 'no context mode',
        schedule_type: 'once',
        schedule_value: '2025-06-01T00:00:00.000Z',
        targetJid: 'other@g.us',
      },
      'main',
      true,
      deps,
    );

    const tasks = getAllTasks();
    expect(tasks[0].context_mode).toBe('isolated');
  });
});

// --- register_group success path ---

describe('register_group success', () => {
  it('main group can register a new group', async () => {
    await processTaskIpc(
      {
        type: 'register_group',
        jid: 'new@g.us',
        name: 'New Group',
        folder: 'new-group',
        trigger: '@Andy',
      },
      'main',
      true,
      deps,
    );

    // Verify group was registered in DB
    const group = getRegisteredGroup('new@g.us');
    expect(group).toBeDefined();
    expect(group!.name).toBe('New Group');
    expect(group!.folder).toBe('new-group');
    expect(group!.trigger).toBe('@Andy');
  });

  it('register_group rejects request with missing fields', async () => {
    await processTaskIpc(
      {
        type: 'register_group',
        jid: 'partial@g.us',
        name: 'Partial',
        // missing folder and trigger
      },
      'main',
      true,
      deps,
    );

    expect(getRegisteredGroup('partial@g.us')).toBeUndefined();
  });
});

// --- Per-message idempotency ---

describe('per-message idempotency', () => {
  it('returns false for unprocessed message', () => {
    expect(isMessageProcessed('group@g.us', 'msg-001')).toBe(false);
  });

  it('returns true after marking message processed', () => {
    markMessageProcessed('group@g.us', 'msg-002');
    expect(isMessageProcessed('group@g.us', 'msg-002')).toBe(true);
  });

  it('stores run_id alongside processed message', () => {
    markMessageProcessed('group@g.us', 'msg-003', 'run-123');
    expect(isMessageProcessed('group@g.us', 'msg-003')).toBe(true);
  });

  it('handles duplicate markMessageProcessed calls gracefully', () => {
    markMessageProcessed('group@g.us', 'msg-004');
    // Should not throw (INSERT OR IGNORE)
    markMessageProcessed('group@g.us', 'msg-004', 'run-456');
    expect(isMessageProcessed('group@g.us', 'msg-004')).toBe(true);
  });

  it('isolates messages by chat_jid', () => {
    markMessageProcessed('group-a@g.us', 'msg-005');
    expect(isMessageProcessed('group-a@g.us', 'msg-005')).toBe(true);
    expect(isMessageProcessed('group-b@g.us', 'msg-005')).toBe(false);
  });

  it('getProcessedMessageIds returns batch results', () => {
    markMessageProcessed('batch@g.us', 'msg-a');
    markMessageProcessed('batch@g.us', 'msg-c');
    const processed = getProcessedMessageIds('batch@g.us', ['msg-a', 'msg-b', 'msg-c']);
    expect(processed).toEqual(new Set(['msg-a', 'msg-c']));
  });

  it('getProcessedMessageIds returns empty set for empty input', () => {
    expect(getProcessedMessageIds('batch@g.us', [])).toEqual(new Set());
  });

  it('markMessagesProcessed inserts batch atomically', () => {
    markMessagesProcessed('txn@g.us', ['msg-x', 'msg-y', 'msg-z'], 'run-batch');
    expect(isMessageProcessed('txn@g.us', 'msg-x')).toBe(true);
    expect(isMessageProcessed('txn@g.us', 'msg-y')).toBe(true);
    expect(isMessageProcessed('txn@g.us', 'msg-z')).toBe(true);
  });
});
