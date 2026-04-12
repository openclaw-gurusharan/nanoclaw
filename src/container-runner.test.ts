import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { PassThrough } from 'stream';

// Sentinel markers must match container-runner.ts
const OUTPUT_START_MARKER = '---NANOCLAW_OUTPUT_START---';
const OUTPUT_END_MARKER = '---NANOCLAW_OUTPUT_END---';
const testState = vi.hoisted(() => ({
  isAppleContainerRuntime: false,
  authMode: 'oauth' as 'oauth' | 'api-key',
  applyContainerConfigMock: vi.fn().mockResolvedValue(true),
  spawnMock: vi.fn(),
  mockPathKinds: new Map<string, 'file' | 'dir'>(),
  copyFileSyncMock: vi.fn(),
}));

// Mock config
vi.mock('./config.js', () => ({
  CONTAINER_IMAGE: 'nanoclaw-agent:latest',
  CONTAINER_MAX_OUTPUT_SIZE: 10485760,
  CONTAINER_TIMEOUT: 1800000, // 30min
  CREDENTIAL_PROXY_PORT: 3001,
  DATA_DIR: '/tmp/nanoclaw-test-data',
  GROUPS_DIR: '/tmp/nanoclaw-test-groups',
  IDLE_TIMEOUT: 1800000, // 30min
  ONECLI_URL: 'http://localhost:10254',
  TIMEZONE: 'America/Los_Angeles',
}));

// Mock logger
vi.mock('./logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock fs
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  const pathKind = (value: unknown) =>
    testState.mockPathKinds.get(String(value)) ?? null;
  return {
    ...actual,
    default: {
      ...actual,
      existsSync: vi.fn((value: unknown) => pathKind(value) !== null),
      mkdirSync: vi.fn((value: unknown) => {
        testState.mockPathKinds.set(String(value), 'dir');
      }),
      writeFileSync: vi.fn(),
      readFileSync: vi.fn(() => ''),
      readdirSync: vi.fn(() => []),
      statSync: vi.fn((value: unknown) => ({
        isDirectory: () => pathKind(value) === 'dir',
        isFile: () => pathKind(value) === 'file',
      })),
      copyFileSync: testState.copyFileSyncMock.mockImplementation(
        (_src: unknown, dst: unknown) => {
          testState.mockPathKinds.set(String(dst), 'file');
        },
      ),
    },
  };
});

// Mock mount-security
vi.mock('./mount-security.js', () => ({
  validateAdditionalMounts: vi.fn(() => []),
}));

vi.mock('./credential-proxy.js', () => ({
  detectAuthMode: vi.fn(() => testState.authMode),
}));

// Mock container-runtime
vi.mock('./container-runtime.js', () => ({
  CONTAINER_HOST_GATEWAY: '192.168.64.1',
  CONTAINER_RUNTIME_BIN: 'docker',
  hostGatewayArgs: () => [],
  readonlyMountArgs: (h: string, c: string) => ['-v', `${h}:${c}:ro`],
  get IS_APPLE_CONTAINER_RUNTIME() {
    return testState.isAppleContainerRuntime;
  },
  stopContainer: vi.fn(),
}));

// Mock OneCLI SDK
vi.mock('@onecli-sh/sdk', () => ({
  OneCLI: class {
    applyContainerConfig = testState.applyContainerConfigMock;
    createAgent = vi.fn().mockResolvedValue({ id: 'test' });
    ensureAgent = vi
      .fn()
      .mockResolvedValue({ name: 'test', identifier: 'test', created: true });
  },
}));

// Create a controllable fake ChildProcess
function createFakeProcess() {
  const proc = new EventEmitter() as EventEmitter & {
    stdin: PassThrough;
    stdout: PassThrough;
    stderr: PassThrough;
    kill: ReturnType<typeof vi.fn>;
    pid: number;
  };
  proc.stdin = new PassThrough();
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  proc.kill = vi.fn();
  proc.pid = 12345;
  return proc;
}

let fakeProc: ReturnType<typeof createFakeProcess>;

// Mock child_process.spawn
vi.mock('child_process', async () => {
  const actual =
    await vi.importActual<typeof import('child_process')>('child_process');
  return {
    ...actual,
    spawn: testState.spawnMock.mockImplementation(() => fakeProc),
    exec: vi.fn(
      (_cmd: string, _opts: unknown, cb?: (err: Error | null) => void) => {
        if (cb) cb(null);
        return new EventEmitter();
      },
    ),
  };
});

import { runContainerAgent, ContainerOutput } from './container-runner.js';
import type { RegisteredGroup } from './types.js';

const testGroup: RegisteredGroup = {
  name: 'Test Group',
  folder: 'test-group',
  trigger: '@Andy',
  added_at: new Date().toISOString(),
};

const testInput = {
  prompt: 'Hello',
  groupFolder: 'test-group',
  chatJid: 'test@g.us',
  isMain: false,
};

function emitOutputMarker(
  proc: ReturnType<typeof createFakeProcess>,
  output: ContainerOutput,
) {
  const json = JSON.stringify(output);
  proc.stdout.push(`${OUTPUT_START_MARKER}\n${json}\n${OUTPUT_END_MARKER}\n`);
}

describe('container-runner timeout behavior', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fakeProc = createFakeProcess();
    testState.isAppleContainerRuntime = false;
    testState.authMode = 'oauth';
    testState.applyContainerConfigMock.mockReset();
    testState.applyContainerConfigMock.mockResolvedValue(true);
    testState.spawnMock.mockClear();
    testState.mockPathKinds.clear();
    testState.copyFileSyncMock.mockClear();
    testState.mockPathKinds.set(
      '/tmp/nanoclaw-test-data/sessions/test-group/.claude',
      'dir',
    );
    testState.mockPathKinds.set(
      '/tmp/nanoclaw-test-data/sessions/test-group/agent-runner-src',
      'dir',
    );
    testState.mockPathKinds.set(`${process.env.HOME}/.codex`, 'dir');
    testState.mockPathKinds.set(`${process.env.HOME}/.codex/bin`, 'dir');
    testState.mockPathKinds.set(`${process.env.HOME}/.codex/docs`, 'dir');
    testState.mockPathKinds.set(`${process.env.HOME}/.codex/knowledge`, 'dir');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('timeout after output resolves as success', async () => {
    const onOutput = vi.fn(async () => {});
    const resultPromise = runContainerAgent(
      testGroup,
      testInput,
      () => {},
      onOutput,
    );

    // Emit output with a result
    emitOutputMarker(fakeProc, {
      status: 'success',
      result: 'Here is my response',
      newSessionId: 'session-123',
    });

    // Let output processing settle
    await vi.advanceTimersByTimeAsync(10);

    // Fire the hard timeout (IDLE_TIMEOUT + 30s = 1830000ms)
    await vi.advanceTimersByTimeAsync(1830000);

    // Emit close event (as if container was stopped by the timeout)
    fakeProc.emit('close', 137);

    // Let the promise resolve
    await vi.advanceTimersByTimeAsync(10);

    const result = await resultPromise;
    expect(result.status).toBe('success');
    expect(result.newSessionId).toBe('session-123');
    expect(onOutput).toHaveBeenCalledWith(
      expect.objectContaining({ result: 'Here is my response' }),
    );
  });

  it('timeout with no output resolves as error', async () => {
    const onOutput = vi.fn(async () => {});
    const resultPromise = runContainerAgent(
      testGroup,
      testInput,
      () => {},
      onOutput,
    );

    // No output emitted — fire the hard timeout
    await vi.advanceTimersByTimeAsync(1830000);

    // Emit close event
    fakeProc.emit('close', 137);

    await vi.advanceTimersByTimeAsync(10);

    const result = await resultPromise;
    expect(result.status).toBe('error');
    expect(result.error).toContain('timed out');
    expect(onOutput).not.toHaveBeenCalled();
  });

  it('normal exit after output resolves as success', async () => {
    const onOutput = vi.fn(async () => {});
    const resultPromise = runContainerAgent(
      testGroup,
      testInput,
      () => {},
      onOutput,
    );

    // Emit output
    emitOutputMarker(fakeProc, {
      status: 'success',
      result: 'Done',
      newSessionId: 'session-456',
    });

    await vi.advanceTimersByTimeAsync(10);

    // Normal exit (no timeout)
    fakeProc.emit('close', 0);

    await vi.advanceTimersByTimeAsync(10);

    const result = await resultPromise;
    expect(result.status).toBe('success');
    expect(result.newSessionId).toBe('session-456');
  });

  it('rewrites OneCLI proxy envs to the Apple bridge host before spawn', async () => {
    testState.isAppleContainerRuntime = true;
    testState.applyContainerConfigMock.mockImplementation(
      async (args: string[]) => {
        args.push(
          '-e',
          'HTTPS_PROXY=http://host.docker.internal:4318',
          '-e',
          'HTTP_PROXY=http://host.docker.internal:4318',
        );
        return true;
      },
    );

    const resultPromise = runContainerAgent(testGroup, testInput, () => {});
    await vi.advanceTimersByTimeAsync(0);

    expect(testState.spawnMock).toHaveBeenCalledTimes(1);
    const spawnArgs = testState.spawnMock.mock.calls[0]?.[1] as string[];
    expect(spawnArgs).toContain('HTTPS_PROXY=http://192.168.64.1:4318');
    expect(spawnArgs).toContain('HTTP_PROXY=http://192.168.64.1:4318');
    expect(spawnArgs).not.toContain(
      'HTTPS_PROXY=http://host.docker.internal:4318',
    );
    expect(spawnArgs).not.toContain(
      'HTTP_PROXY=http://host.docker.internal:4318',
    );

    emitOutputMarker(fakeProc, {
      status: 'success',
      result: 'bridged',
      newSessionId: 'session-bridge',
    });
    await vi.advanceTimersByTimeAsync(10);
    fakeProc.emit('close', 0);
    await vi.advanceTimersByTimeAsync(10);

    await expect(resultPromise).resolves.toMatchObject({
      status: 'success',
      newSessionId: 'session-bridge',
    });
  });

  it('removes OneCLI API key env when oauth auth mode is active', async () => {
    testState.applyContainerConfigMock.mockImplementation(
      async (args: string[]) => {
        args.push(
          '-e',
          'ANTHROPIC_API_KEY=placeholder',
          '-e',
          'HTTPS_PROXY=http://192.168.64.1:10255',
        );
        return true;
      },
    );

    const resultPromise = runContainerAgent(testGroup, testInput, () => {});
    await vi.advanceTimersByTimeAsync(0);

    expect(testState.spawnMock).toHaveBeenCalledTimes(1);
    const spawnArgs = testState.spawnMock.mock.calls[0]?.[1] as string[];
    expect(spawnArgs).toContain('CLAUDE_CODE_OAUTH_TOKEN=placeholder');
    expect(spawnArgs).not.toContain('ANTHROPIC_API_KEY=placeholder');
    expect(spawnArgs).toContain('HTTPS_PROXY=http://192.168.64.1:10255');

    emitOutputMarker(fakeProc, {
      status: 'success',
      result: 'oauth-only',
      newSessionId: 'session-oauth',
    });
    await vi.advanceTimersByTimeAsync(10);
    fakeProc.emit('close', 0);
    await vi.advanceTimersByTimeAsync(10);

    await expect(resultPromise).resolves.toMatchObject({
      status: 'success',
      newSessionId: 'session-oauth',
    });
  });

  it('routes the main lane through the andy-bot OneCLI agent', async () => {
    const mainGroup: RegisteredGroup = {
      ...testGroup,
      name: 'Andy',
      folder: 'main',
      isMain: true,
    };
    const mainInput = {
      ...testInput,
      groupFolder: 'main',
      isMain: true,
    };

    const resultPromise = runContainerAgent(mainGroup, mainInput, () => {});
    await vi.advanceTimersByTimeAsync(0);

    expect(testState.applyContainerConfigMock).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ agent: 'andy-bot' }),
    );
    expect(testState.spawnMock).toHaveBeenCalledTimes(1);
    const spawnArgs = testState.spawnMock.mock.calls[0]?.[1] as string[];
    expect(spawnArgs).toContain('CLAUDE_CODE_OAUTH_TOKEN=placeholder');
    expect(spawnArgs).toContain('GH_TOKEN=placeholder');
    expect(spawnArgs).toContain('GITHUB_TOKEN=placeholder');

    emitOutputMarker(fakeProc, {
      status: 'success',
      result: 'main-andy-bot',
      newSessionId: 'session-main',
    });
    await vi.advanceTimersByTimeAsync(10);
    fakeProc.emit('close', 0);
    await vi.advanceTimersByTimeAsync(10);

    await expect(resultPromise).resolves.toMatchObject({
      status: 'success',
      newSessionId: 'session-main',
    });
  });

  it('mounts only workflow retrieval surfaces read-only into the container', async () => {
    const resultPromise = runContainerAgent(testGroup, testInput, () => {});
    await vi.advanceTimersByTimeAsync(0);

    expect(testState.spawnMock).toHaveBeenCalledTimes(1);
    const spawnArgs = testState.spawnMock.mock.calls[0]?.[1] as string[];
    expect(spawnArgs).toContain('-v');
    expect(spawnArgs).toContain(
      `${process.env.HOME}/.codex/bin:/home/node/.codex/bin:ro`,
    );
    expect(spawnArgs).toContain(
      `${process.env.HOME}/.codex/docs:/home/node/.codex/docs:ro`,
    );
    expect(spawnArgs).toContain(
      `${process.env.HOME}/.codex/knowledge:/home/node/.codex/knowledge:ro`,
    );
    expect(spawnArgs).not.toContain(
      `${process.env.HOME}/.codex:/home/node/.codex:ro`,
    );

    emitOutputMarker(fakeProc, {
      status: 'success',
      result: 'codex-mounted',
      newSessionId: 'session-codex',
    });
    await vi.advanceTimersByTimeAsync(10);
    fakeProc.emit('close', 0);
    await vi.advanceTimersByTimeAsync(10);

    await expect(resultPromise).resolves.toMatchObject({
      status: 'success',
      newSessionId: 'session-codex',
    });
  });

  it('adds a no-proxy bypass for the host credential proxy', async () => {
    testState.applyContainerConfigMock.mockImplementation(
      async (args: string[]) => {
        args.push(
          '-e',
          'HTTP_PROXY=http://192.168.64.1:10255',
          '-e',
          'NO_PROXY=example.internal',
        );
        return true;
      },
    );

    const resultPromise = runContainerAgent(testGroup, testInput, () => {});
    await vi.advanceTimersByTimeAsync(0);

    expect(testState.spawnMock).toHaveBeenCalledTimes(1);
    const spawnArgs = testState.spawnMock.mock.calls[0]?.[1] as string[];
    expect(spawnArgs).toContain(
      'NO_PROXY=example.internal,127.0.0.1,localhost,host.docker.internal,192.168.64.1',
    );
    expect(spawnArgs).toContain(
      'no_proxy=example.internal,127.0.0.1,localhost,host.docker.internal,192.168.64.1',
    );
    expect(spawnArgs).toContain('HTTP_PROXY=http://192.168.64.1:10255');

    emitOutputMarker(fakeProc, {
      status: 'success',
      result: 'no-proxy',
      newSessionId: 'session-no-proxy',
    });
    await vi.advanceTimersByTimeAsync(10);
    fakeProc.emit('close', 0);
    await vi.advanceTimersByTimeAsync(10);

    await expect(resultPromise).resolves.toMatchObject({
      status: 'success',
      newSessionId: 'session-no-proxy',
    });
  });

  it('stages OneCLI CA files into a directory mount for Apple Container', async () => {
    testState.isAppleContainerRuntime = true;
    testState.mockPathKinds.set('/tmp/onecli-proxy-ca.pem', 'file');
    testState.mockPathKinds.set('/tmp/onecli-combined-ca.pem', 'file');
    testState.applyContainerConfigMock.mockImplementation(
      async (args: string[]) => {
        args.push(
          '-e',
          'NODE_EXTRA_CA_CERTS=/tmp/onecli-gateway-ca.pem',
          '-v',
          '/tmp/onecli-proxy-ca.pem:/tmp/onecli-gateway-ca.pem:ro',
          '-e',
          'SSL_CERT_FILE=/tmp/onecli-combined-ca.pem',
          '-v',
          '/tmp/onecli-combined-ca.pem:/tmp/onecli-combined-ca.pem:ro',
        );
        return true;
      },
    );

    const resultPromise = runContainerAgent(testGroup, testInput, () => {});
    await vi.advanceTimersByTimeAsync(0);

    expect(testState.spawnMock).toHaveBeenCalledTimes(1);
    const spawnArgs = testState.spawnMock.mock.calls[0]?.[1] as string[];
    expect(spawnArgs).toContain(
      'NODE_EXTRA_CA_CERTS=/tmp/nanoclaw-onecli/onecli-gateway-ca.pem',
    );
    expect(spawnArgs).toContain(
      'SSL_CERT_FILE=/tmp/nanoclaw-onecli/onecli-combined-ca.pem',
    );
    expect(
      spawnArgs.some(
        (arg) =>
          typeof arg === 'string' &&
          arg.includes('/tmp/nanoclaw-test-data/onecli-mounts/') &&
          arg.endsWith(':/tmp/nanoclaw-onecli:ro'),
      ),
    ).toBe(true);
    expect(spawnArgs).not.toContain(
      '/tmp/onecli-proxy-ca.pem:/tmp/onecli-gateway-ca.pem:ro',
    );
    expect(spawnArgs).not.toContain(
      '/tmp/onecli-combined-ca.pem:/tmp/onecli-combined-ca.pem:ro',
    );
    expect(testState.copyFileSyncMock).toHaveBeenCalledTimes(2);

    emitOutputMarker(fakeProc, {
      status: 'success',
      result: 'staged-certs',
      newSessionId: 'session-certs',
    });
    await vi.advanceTimersByTimeAsync(10);
    fakeProc.emit('close', 0);
    await vi.advanceTimersByTimeAsync(10);

    await expect(resultPromise).resolves.toMatchObject({
      status: 'success',
      newSessionId: 'session-certs',
    });
  });
});
