/**
 * Container runtime abstraction for NanoClaw.
 * All runtime-specific logic lives here so swapping runtimes means changing one file.
 */
import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';

import { logger } from './logger.js';

/** The container runtime binary name. */
export const CONTAINER_RUNTIME_BIN =
  process.env.CONTAINER_RUNTIME_BIN ||
  process.env.CONTAINER_RUNTIME ||
  'container';

export const IS_APPLE_CONTAINER_RUNTIME = /(^|\/)container$/.test(
  CONTAINER_RUNTIME_BIN,
);

interface RuntimeContainer {
  id: string;
  state: string;
}

/**
 * Address (IP or hostname) containers use to reach the host machine.
 * Apple Container: uses the bridge100 host IP directly (host.docker.internal is not built-in).
 * Docker Desktop / other: uses host.docker.internal (resolved by Docker's VM routing).
 */
export const CONTAINER_HOST_GATEWAY: string = IS_APPLE_CONTAINER_RUNTIME
  ? appleContainerBridgeIp()
  : 'host.docker.internal';

/**
 * Address the credential proxy binds to.
 * Docker Desktop (macOS): 127.0.0.1 — the VM routes host.docker.internal to loopback.
 * Docker (Linux): bind to the docker0 bridge IP so only containers can reach it,
 *   falling back to 0.0.0.0 if the interface isn't found.
 */
export const PROXY_BIND_HOST =
  process.env.CREDENTIAL_PROXY_HOST || detectProxyBindHost();

/**
 * Returns the host-side IP of the Apple Container bridge network (bridge100).
 * Containers are on 192.168.64.0/24; the host is always the first address (.1).
 * Falls back to '0.0.0.0' if the interface isn't found.
 */
function appleContainerBridgeIp(): string {
  const ifaces = os.networkInterfaces();
  const bridge = ifaces['bridge100'];
  if (bridge) {
    const ipv4 = bridge.find((a) => a.family === 'IPv4');
    if (ipv4) return ipv4.address;
  }
  return '0.0.0.0';
}

function detectProxyBindHost(): string {
  // Apple Container (macOS): containers live on a separate bridge network (192.168.64.x).
  // host.docker.internal is NOT built-in — we add it via --add-host (see hostGatewayArgs).
  // Bind the proxy to the bridge IP so containers can reach it at that address.
  if (IS_APPLE_CONTAINER_RUNTIME) return appleContainerBridgeIp();

  // Docker Desktop (macOS): the VM routes host.docker.internal to loopback.
  if (os.platform() === 'darwin') return '127.0.0.1';

  // WSL uses Docker Desktop (same VM routing as macOS) — loopback is correct.
  // Check /proc filesystem, not env vars — WSL_DISTRO_NAME isn't set under systemd.
  if (fs.existsSync('/proc/sys/fs/binfmt_misc/WSLInterop')) return '127.0.0.1';

  // Bare-metal Linux: bind to the docker0 bridge IP instead of 0.0.0.0
  const ifaces = os.networkInterfaces();
  const docker0 = ifaces['docker0'];
  if (docker0) {
    const ipv4 = docker0.find((a) => a.family === 'IPv4');
    if (ipv4) return ipv4.address;
  }
  return '0.0.0.0';
}

/** CLI args needed for the container to resolve the host gateway. */
export function hostGatewayArgs(): string[] {
  // Apple Container: CONTAINER_HOST_GATEWAY is already the bridge IP — no extra args needed.
  if (IS_APPLE_CONTAINER_RUNTIME) return [];
  // Docker Desktop (macOS): host.docker.internal is built-in via VM routing.
  // On Linux, add it explicitly via the host-gateway alias.
  if (os.platform() === 'linux') {
    return ['--add-host=host.docker.internal:host-gateway'];
  }
  return [];
}

/** Returns CLI args for a readonly bind mount. */
export function readonlyMountArgs(
  hostPath: string,
  containerPath: string,
): string[] {
  if (IS_APPLE_CONTAINER_RUNTIME) {
    return [
      '--mount',
      `type=bind,source=${hostPath},target=${containerPath},readonly`,
    ];
  }
  return ['-v', `${hostPath}:${containerPath}:ro`];
}

const SAFE_CONTAINER_NAME = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;

/** Stop a container by name. Throws on invalid names to prevent command injection. */
export function stopContainer(name: string): void {
  if (!SAFE_CONTAINER_NAME.test(name)) {
    throw new Error(`Invalid container name: ${name}`);
  }
  execSync(`${CONTAINER_RUNTIME_BIN} stop -t 1 ${name}`, { stdio: 'pipe' });
}

function parseContainersFromJson(output: string): RuntimeContainer[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(output || '[]');
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const result: RuntimeContainer[] = [];
  for (const raw of parsed) {
    if (!raw || typeof raw !== 'object') continue;
    const obj = raw as {
      status?: unknown;
      state?: unknown;
      configuration?: { id?: unknown } | unknown;
      id?: unknown;
      name?: unknown;
    };

    const state =
      typeof obj.status === 'string'
        ? obj.status
        : typeof obj.state === 'string'
          ? obj.state
          : '';
    const id =
      obj.configuration &&
      typeof obj.configuration === 'object' &&
      typeof (obj.configuration as { id?: unknown }).id === 'string'
        ? (obj.configuration as { id: string }).id
        : typeof obj.id === 'string'
          ? obj.id
          : typeof obj.name === 'string'
            ? obj.name
            : '';

    if (!id || !state) continue;
    result.push({ id, state });
  }
  return result;
}

function parseContainersFromTable(output: string): RuntimeContainer[] {
  const lines = output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) return [];

  const containers: RuntimeContainer[] = [];
  // Skip header row ("ID IMAGE OS ARCH STATE ADDR")
  for (const line of lines.slice(1)) {
    const cols = line.split(/\s+/);
    if (cols.length < 5) continue;
    containers.push({
      id: cols[0],
      state: cols[4],
    });
  }
  return containers;
}

function runtimeHealthCommand(): string {
  return IS_APPLE_CONTAINER_RUNTIME
    ? `${CONTAINER_RUNTIME_BIN} system status`
    : `${CONTAINER_RUNTIME_BIN} info`;
}

function runtimeListContainersCommand(): string {
  return IS_APPLE_CONTAINER_RUNTIME
    ? `${CONTAINER_RUNTIME_BIN} ls -a`
    : `${CONTAINER_RUNTIME_BIN} ps --filter name=nanoclaw- --format '{{.Names}}'`;
}

function parseNanoclawContainers(output: string): string[] {
  if (!output.trim()) return [];

  if (IS_APPLE_CONTAINER_RUNTIME) {
    const lines = output
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length <= 1) return [];
    return lines
      .slice(1)
      .map((line) => line.split(/\s+/)[0])
      .filter((name) => name.startsWith('nanoclaw-'));
  }

  return output
    .trim()
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('nanoclaw-'));
}

function listContainers(): RuntimeContainer[] {
  // Preferred path: structured JSON output
  try {
    const output = execSync(`${CONTAINER_RUNTIME_BIN} ls --format json`, {
      stdio: ['pipe', 'pipe', 'pipe'],
      encoding: 'utf-8',
      timeout: 10000,
    });
    const parsed = parseContainersFromJson(output);
    if (parsed.length > 0 || output.trim() === '[]') {
      return parsed;
    }
  } catch {
    // Fall through to table parser
  }

  // Fallback: parse table output
  const output = execSync(`${CONTAINER_RUNTIME_BIN} ls -a`, {
    stdio: ['pipe', 'pipe', 'pipe'],
    encoding: 'utf-8',
    timeout: 10000,
  });
  return parseContainersFromTable(output);
}

function isContainerRunning(name: string): boolean {
  return listContainers().some((c) => c.id === name && c.state === 'running');
}

function formatErr(err: unknown): string {
  if (err instanceof Error) {
    return err.message.split('\n')[0] || err.message;
  }
  return String(err);
}

export interface StopContainerResult {
  stopped: boolean;
  attempts: string[];
}

export interface StopContainersByPrefixResult {
  matched: string[];
  stopped: string[];
  failures: Array<{ name: string; attempts: string[] }>;
}

/**
 * Stop a container and verify it is no longer running.
 * Escalates from graceful stop to SIGKILL/kill when needed.
 */
export function stopContainerWithVerification(
  name: string,
): StopContainerResult {
  const attempts: string[] = [];
  const commands = [
    `${CONTAINER_RUNTIME_BIN} stop -t 1 ${name}`,
    `${CONTAINER_RUNTIME_BIN} stop -s SIGKILL -t 1 ${name}`,
    `${CONTAINER_RUNTIME_BIN} kill ${name}`,
  ];

  for (const cmd of commands) {
    try {
      execSync(cmd, { stdio: 'pipe', timeout: 10000 });
      attempts.push(`ok: ${cmd}`);
    } catch (err) {
      attempts.push(`err: ${cmd}: ${formatErr(err)}`);
    }

    try {
      if (!isContainerRunning(name)) {
        attempts.push(`verified stopped: ${name}`);
        return { stopped: true, attempts };
      }
      attempts.push(`still running after: ${cmd}`);
    } catch (err) {
      attempts.push(`err: verify ${name}: ${formatErr(err)}`);
    }
  }

  return { stopped: false, attempts };
}

/**
 * Stop all running containers whose id starts with `prefix`.
 * Returns detailed stop attempts for any failures.
 */
export function stopRunningContainersByPrefix(
  prefix: string,
): StopContainersByPrefixResult {
  const matched = listContainers()
    .filter((c) => c.state === 'running' && c.id.startsWith(prefix))
    .map((c) => c.id);

  const stopped: string[] = [];
  const failures: Array<{ name: string; attempts: string[] }> = [];

  for (const name of matched) {
    const result = stopContainerWithVerification(name);
    if (result.stopped) {
      stopped.push(name);
    } else {
      failures.push({ name, attempts: result.attempts });
    }
  }

  return { matched, stopped, failures };
}

/** Ensure the container runtime is running, starting it if needed. */
export function ensureContainerRuntimeRunning(): void {
  try {
    execSync(runtimeHealthCommand(), { stdio: 'pipe', timeout: 10000 });
    logger.debug('Container runtime already running');
  } catch (err) {
    logger.error({ err }, 'Failed to reach container runtime');
    throw new Error('Container runtime is required but failed to start');
  }
}

/** Kill orphaned NanoClaw containers from previous runs. */
export function cleanupOrphans(): void {
  try {
    const { matched, stopped, failures } =
      stopRunningContainersByPrefix('nanoclaw-');
    if (matched.length === 0) return;

    for (const failure of failures) {
      logger.warn(
        { name: failure.name, attempts: failure.attempts },
        'Failed to stop orphaned container',
      );
    }

    if (stopped.length > 0) {
      logger.info(
        { count: stopped.length, names: stopped },
        'Stopped orphaned containers',
      );
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to clean up orphaned containers');
  }
}

/** Check if there is any running container whose id starts with prefix. */
export function hasRunningContainerWithPrefix(prefix: string): boolean {
  return listContainers().some(
    (c) => c.state === 'running' && c.id.startsWith(prefix),
  );
}
