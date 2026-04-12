import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockExistsSync = vi.fn();
const mockExecFile = vi.fn();

vi.mock('fs', () => ({
  default: {
    existsSync: (...args: unknown[]) => mockExistsSync(...args),
  },
}));

vi.mock('child_process', () => ({
  execFile: (...args: unknown[]) => mockExecFile(...args),
}));

vi.mock('./logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('startSessionCleanup', () => {
  it('skips scheduling when the cleanup script is missing', async () => {
    mockExistsSync.mockReturnValue(false);

    const { startSessionCleanup } = await import('./session-cleanup.js');
    const { logger } = await import('./logger.js');

    startSessionCleanup();
    await vi.advanceTimersByTimeAsync(30_000);

    expect(mockExecFile).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalledWith(
      {
        scriptPath: expect.stringContaining('scripts/cleanup-sessions.sh'),
      },
      'Session cleanup hook not installed, skipping',
    );
  });

  it('runs cleanup after the startup delay when the script exists', async () => {
    mockExistsSync.mockReturnValue(true);

    const { startSessionCleanup } = await import('./session-cleanup.js');

    startSessionCleanup();
    await vi.advanceTimersByTimeAsync(30_000);

    expect(mockExecFile).toHaveBeenCalledTimes(1);
    expect(mockExecFile).toHaveBeenCalledWith(
      '/bin/bash',
      [expect.stringContaining('scripts/cleanup-sessions.sh')],
      { timeout: 60_000 },
      expect.any(Function),
    );
  });
});
