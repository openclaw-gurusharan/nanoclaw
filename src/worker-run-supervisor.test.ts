import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockHasRunningContainerWithPrefix = vi.fn();
vi.mock('./container-runtime.js', () => ({
  hasRunningContainerWithPrefix: (...args: unknown[]) =>
    mockHasRunningContainerWithPrefix(...args),
}));

vi.mock('./logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import {
  _initTestDatabase,
  getWorkerRun,
  insertWorkerRun,
  updateWorkerRunLifecycle,
  updateWorkerRunStatus,
} from './db.js';
import { WorkerRunSupervisor } from './worker-run-supervisor.js';

const supervisor = new WorkerRunSupervisor({
  hardTimeoutMs: 60 * 60 * 1000,
  probeQueuedTimeoutMs: 5 * 60 * 1000,
  probeRunningTimeoutMs: 10 * 60 * 1000,
  queuedCursorGraceMs: 0,
  leaseTtlMs: 60 * 1000,
  processStartAtMs: Date.now() - 5 * 60 * 1000,
  restartSuppressionWindowMs: 60 * 1000,
  ownerId: 'test-supervisor',
});

beforeEach(() => {
  vi.useRealTimers();
  _initTestDatabase();
  vi.clearAllMocks();
});

describe('WorkerRunSupervisor.reconcile', () => {
  it('does not auto-fail running run that loses its container', () => {
    insertWorkerRun('run-super-1', 'jarvis-worker-1');
    updateWorkerRunStatus('run-super-1', 'running');
    updateWorkerRunLifecycle('run-super-1', {
      phase: 'active',
      no_container_since: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
      last_heartbeat_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
      lease_expires_at: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
    });
    mockHasRunningContainerWithPrefix.mockReturnValue(false);

    const changed = supervisor.reconcile({
      lastAgentTimestamp: {},
      resolveChatJid: () => undefined,
    });

    const row = getWorkerRun('run-super-1');
    expect(changed).toBe(false);
    expect(row?.status).toBe('running');
  });

  it('does not auto-fail running repair_pending run with no container', () => {
    insertWorkerRun('run-super-2', 'jarvis-worker-2');
    updateWorkerRunStatus('run-super-2', 'running');
    updateWorkerRunLifecycle('run-super-2', {
      phase: 'completion_repair_pending',
      no_container_since: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
      last_heartbeat_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
      lease_expires_at: new Date(Date.now() - 1 * 60 * 1000).toISOString(),
    });
    mockHasRunningContainerWithPrefix.mockReturnValue(false);

    const changed = supervisor.reconcile({
      lastAgentTimestamp: {},
      resolveChatJid: () => undefined,
    });

    const row = getWorkerRun('run-super-2');
    expect(changed).toBe(false);
    expect(row?.status).toBe('running');
  });

  it('promotes repair_pending to repair_active when container is detected', () => {
    insertWorkerRun('run-super-3', 'jarvis-worker-3');
    updateWorkerRunStatus('run-super-3', 'running');
    updateWorkerRunLifecycle('run-super-3', {
      phase: 'completion_repair_pending',
      no_container_since: new Date(Date.now() - 30 * 1000).toISOString(),
      active_container_name: null,
    });
    mockHasRunningContainerWithPrefix.mockReturnValue(true);

    const changed = supervisor.reconcile({
      lastAgentTimestamp: {},
      resolveChatJid: () => undefined,
    });

    const row = getWorkerRun('run-super-3');
    expect(changed).toBe(true);
    expect(row?.status).toBe('running');
    expect(row?.phase).toBe('completion_repair_active');
    expect(row?.no_container_since).toBeNull();
    expect(row?.active_container_name).toContain('prefix:nanoclaw-jarvis-worker-3-');
  });

  it('fails queued run when group cursor is already past dispatch timestamp', () => {
    insertWorkerRun('run-super-4', 'jarvis-worker-4');
    const cursor = new Date(Date.now() + 60_000).toISOString();
    mockHasRunningContainerWithPrefix.mockReturnValue(false);

    const changed = supervisor.reconcile({
      lastAgentTimestamp: { 'jid-1': cursor },
      resolveChatJid: () => 'jid-1',
    });

    const row = getWorkerRun('run-super-4');
    expect(changed).toBe(true);
    expect(row?.status).toBe('failed_timeout');
    expect(row?.phase).toBe('terminal');
    expect(row?.error_details).toContain('"reason":"queued_stale_before_spawn"');
  });

  it('does not fail queued run from cursor mismatch when spawn was already acknowledged', () => {
    insertWorkerRun('run-super-5', 'jarvis-worker-5');
    updateWorkerRunLifecycle('run-super-5', {
      spawn_acknowledged_at: new Date().toISOString(),
    });
    const cursor = new Date(Date.now() + 60_000).toISOString();
    mockHasRunningContainerWithPrefix.mockReturnValue(false);

    const changed = supervisor.reconcile({
      lastAgentTimestamp: { 'jid-5': cursor },
      resolveChatJid: () => 'jid-5',
    });

    const row = getWorkerRun('run-super-5');
    expect(changed).toBe(false);
    expect(row?.status).toBe('queued');
    expect(row?.error_details).toBeNull();
  });

  it('suppresses queued cursor stale failure during startup grace window', () => {
    const startupSupervisor = new WorkerRunSupervisor({
      hardTimeoutMs: 60 * 60 * 1000,
      probeQueuedTimeoutMs: 5 * 60 * 1000,
      probeRunningTimeoutMs: 10 * 60 * 1000,
      queuedCursorGraceMs: 0,
      leaseTtlMs: 60 * 1000,
      processStartAtMs: Date.now(),
      restartSuppressionWindowMs: 60 * 1000,
      ownerId: 'startup-supervisor',
    });
    insertWorkerRun('run-super-6', 'jarvis-worker-6');
    const cursor = new Date(Date.now() + 60_000).toISOString();
    mockHasRunningContainerWithPrefix.mockReturnValue(false);

    const changed = startupSupervisor.reconcile({
      lastAgentTimestamp: { 'jid-6': cursor },
      resolveChatJid: () => 'jid-6',
    });

    const row = getWorkerRun('run-super-6');
    expect(changed).toBe(false);
    expect(row?.status).toBe('queued');
    expect(row?.error_details).toBeNull();
  });

  it('does not fail queued run from cursor mismatch before queued cursor grace expires', () => {
    const graceSupervisor = new WorkerRunSupervisor({
      hardTimeoutMs: 60 * 60 * 1000,
      probeQueuedTimeoutMs: 5 * 60 * 1000,
      probeRunningTimeoutMs: 10 * 60 * 1000,
      queuedCursorGraceMs: 5 * 60 * 1000,
      leaseTtlMs: 60 * 1000,
      processStartAtMs: Date.now() - 10 * 60 * 1000,
      restartSuppressionWindowMs: 60 * 1000,
      ownerId: 'grace-supervisor',
    });
    insertWorkerRun('run-super-7', 'jarvis-worker-7');
    const cursor = new Date(Date.now() + 60_000).toISOString();
    mockHasRunningContainerWithPrefix.mockReturnValue(false);

    const changed = graceSupervisor.reconcile({
      lastAgentTimestamp: { 'jid-7': cursor },
      resolveChatJid: () => 'jid-7',
    });

    const row = getWorkerRun('run-super-7');
    expect(changed).toBe(false);
    expect(row?.status).toBe('queued');
    expect(row?.error_details).toBeNull();
  });

  it('auto-fails stale queued probe runs using probe timeout', () => {
    const probeSupervisor = new WorkerRunSupervisor({
      hardTimeoutMs: 60 * 60 * 1000,
      probeQueuedTimeoutMs: 1,
      probeRunningTimeoutMs: 10 * 60 * 1000,
      queuedCursorGraceMs: 5 * 60 * 1000,
      leaseTtlMs: 60 * 1000,
      processStartAtMs: Date.now() - 10 * 60 * 1000,
      restartSuppressionWindowMs: 60 * 1000,
      ownerId: 'probe-queue-supervisor',
    });
    vi.useFakeTimers();
    const start = new Date('2026-03-03T00:00:00.000Z');
    vi.setSystemTime(start);
    insertWorkerRun('probe-jarvis-worker-1-queue-stale', 'jarvis-worker-1');
    vi.setSystemTime(new Date(start.getTime() + 2_000));
    mockHasRunningContainerWithPrefix.mockReturnValue(false);

    const changed = probeSupervisor.reconcile({
      lastAgentTimestamp: {},
      resolveChatJid: () => undefined,
    });

    const row = getWorkerRun('probe-jarvis-worker-1-queue-stale');
    expect(changed).toBe(true);
    expect(row?.status).toBe('failed_timeout');
    expect(row?.error_details).toContain('"reason":"stale_probe_queued_watchdog"');
  });

  it('auto-fails stale running probe runs using probe timeout', () => {
    const probeSupervisor = new WorkerRunSupervisor({
      hardTimeoutMs: 60 * 60 * 1000,
      probeQueuedTimeoutMs: 5 * 60 * 1000,
      probeRunningTimeoutMs: 1,
      queuedCursorGraceMs: 5 * 60 * 1000,
      leaseTtlMs: 60 * 1000,
      processStartAtMs: Date.now() - 10 * 60 * 1000,
      restartSuppressionWindowMs: 60 * 1000,
      ownerId: 'probe-running-supervisor',
    });
    vi.useFakeTimers();
    const start = new Date('2026-03-03T00:10:00.000Z');
    vi.setSystemTime(start);
    insertWorkerRun('probe-jarvis-worker-2-running-stale', 'jarvis-worker-2');
    updateWorkerRunStatus('probe-jarvis-worker-2-running-stale', 'running');
    updateWorkerRunLifecycle('probe-jarvis-worker-2-running-stale', {
      phase: 'active',
    });
    vi.setSystemTime(new Date(start.getTime() + 2_000));
    mockHasRunningContainerWithPrefix.mockReturnValue(false);

    const changed = probeSupervisor.reconcile({
      lastAgentTimestamp: {},
      resolveChatJid: () => undefined,
    });

    const row = getWorkerRun('probe-jarvis-worker-2-running-stale');
    expect(changed).toBe(true);
    expect(row?.status).toBe('failed_timeout');
    expect(row?.error_details).toContain('"reason":"stale_probe_run_watchdog"');
  });

  it('keeps reconciling queued runs when container liveness check throws', () => {
    const resilientSupervisor = new WorkerRunSupervisor({
      hardTimeoutMs: 60 * 60 * 1000,
      probeQueuedTimeoutMs: 1,
      probeRunningTimeoutMs: 10 * 60 * 1000,
      queuedCursorGraceMs: 5 * 60 * 1000,
      leaseTtlMs: 60 * 1000,
      processStartAtMs: Date.now() - 10 * 60 * 1000,
      restartSuppressionWindowMs: 60 * 1000,
      ownerId: 'resilient-supervisor',
    });

    vi.useFakeTimers();
    const start = new Date('2026-03-03T00:20:00.000Z');
    vi.setSystemTime(start);
    insertWorkerRun('probe-jarvis-worker-1-queue-resilience', 'jarvis-worker-1');
    insertWorkerRun('probe-jarvis-worker-1-running-resilience', 'jarvis-worker-1');
    updateWorkerRunStatus('probe-jarvis-worker-1-running-resilience', 'running');
    vi.setSystemTime(new Date(start.getTime() + 2_000));
    mockHasRunningContainerWithPrefix.mockImplementation(() => {
      throw new Error('container liveness unavailable');
    });

    const changed = resilientSupervisor.reconcile({
      lastAgentTimestamp: {},
      resolveChatJid: () => undefined,
    });

    const queuedRow = getWorkerRun('probe-jarvis-worker-1-queue-resilience');
    expect(changed).toBe(true);
    expect(queuedRow?.status).toBe('failed_timeout');
    expect(queuedRow?.error_details).toContain('"reason":"stale_probe_queued_watchdog"');
  });
});
