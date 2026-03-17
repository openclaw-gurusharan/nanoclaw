/**
 * Container Runner for NanoClaw
 * Spawns agent execution in containers and handles IPC
 */
import { ChildProcess, exec, spawn } from 'child_process';
import { createHash } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  CONTAINER_IMAGE,
  CONTAINER_MAX_OUTPUT_SIZE,
  CONTAINER_NO_OUTPUT_TIMEOUT,
  CONTAINER_PARSE_BUFFER_LIMIT,
  CONTAINER_TIMEOUT,
  CREDENTIAL_PROXY_PORT,
  DATA_DIR,
  GROUPS_DIR,
  IDLE_TIMEOUT,
  WORKER_MIN_NO_OUTPUT_TIMEOUT_MS,
  TIMEZONE,
  WORKER_CONTAINER_IMAGE,
} from './config.js';
import { writeFileAtomic, writeJsonAtomic } from './fs-atomic.js';
import { resolveGroupFolderPath, resolveGroupIpcPath } from './group-folder.js';
import { logger } from './logger.js';
import {
  CONTAINER_HOST_GATEWAY,
  CONTAINER_RUNTIME_BIN,
  hostGatewayArgs,
  readonlyMountArgs,
  stopContainer,
  stopRunningContainersByPrefix,
} from './container-runtime.js';
import { detectAuthMode } from './credential-proxy.js';
import { readEnvFile } from './env.js';
import { validateAdditionalMounts } from './mount-security.js';
import { isJarvisWorkerFolder, RegisteredGroup } from './types.js';

// Sentinel markers for robust output parsing (must match agent-runner)
const OUTPUT_START_MARKER = '---NANOCLAW_OUTPUT_START---';
const OUTPUT_END_MARKER = '---NANOCLAW_OUTPUT_END---';

// Must match AGENT_RUNNER_LOG_PREFIX in container/agent-runner/src/index.ts
const AGENT_RUNNER_LOG_PREFIX = '[agent-runner]';
const OPENCODE_HEARTBEAT_LOG = 'heartbeat worker-opencode-active';

export interface ContainerInput {
  prompt: string;
  sessionId?: string;
  runId?: string;
  groupFolder: string;
  chatJid: string;
  isMain: boolean;
  isScheduledTask?: boolean;
  assistantName?: string;
  opsExtended?: boolean;
  schedulerEnabled?: boolean;
  workerSteeringEnabled?: boolean;
  dynamicGroupRegistrationEnabled?: boolean;
  secrets?: Record<string, string>;
}

export interface ContainerOutput {
  status: 'success' | 'error';
  result: string | null;
  newSessionId?: string;
  sessionResumeStatus?: 'resumed' | 'fallback_new' | 'new';
  sessionResumeError?: string;
  error?: string;
  agentId?: string;
  agentType?: string;
}

interface VolumeMount {
  hostPath: string;
  containerPath: string;
  readonly: boolean;
}

interface AgentRunnerSourceSyncMetadata {
  baselineHash: string;
  syncedAt: string;
}

function shouldTreatAgentRunnerStderrAsProgress(chunk: string): boolean {
  return (
    chunk.includes(AGENT_RUNNER_LOG_PREFIX) &&
    !chunk.includes(OPENCODE_HEARTBEAT_LOG)
  );
}

const AGENT_RUNNER_SYNC_METADATA_FILENAME = 'agent-runner-src.sync.json';
const DEFAULT_MODEL_SECRET_KEYS = [
  'MINIMAX_API_KEY',
  'OPENROUTER_API_KEY',
  'ANTHROPIC_API_KEY',
] as const;

type SessionMcpConfig = {
  mcpServers?: Record<string, unknown>;
};

function readRuntimeConfigValue(name: string): string | undefined {
  const fromProcess = process.env[name]?.trim();
  if (fromProcess) return fromProcess;
  const fromEnvFile = readEnvFile([name])[name]?.trim();
  return fromEnvFile || undefined;
}

function readSecretValue(name: string): string | undefined {
  return readRuntimeConfigValue(name);
}

function isTruthyEnvValue(value: string | undefined): boolean {
  if (!value) return false;
  return /^(true|1|yes|on)$/i.test(value.trim());
}

export function resolveWorkerRuntimeMode(): 'agent' | 'opencode' | 'auto' {
  const configured = readRuntimeConfigValue(
    'WORKER_RUNTIME_MODE',
  )?.toLowerCase();
  if (configured === 'agent' || configured === 'opencode') {
    return configured;
  }
  return 'auto';
}

export function shouldUseAgentRuntimeForWorkers(): boolean {
  const mode = resolveWorkerRuntimeMode();
  if (mode === 'agent') return true;
  if (mode === 'opencode') return false;

  const apiFallbackEnabled = isTruthyEnvValue(
    readRuntimeConfigValue('OAUTH_API_FALLBACK_ENABLED'),
  );
  const model = (
    readRuntimeConfigValue('ANTHROPIC_DEFAULT_SONNET_MODEL') || ''
  ).toLowerCase();

  return apiFallbackEnabled && model.startsWith('minimax');
}

export function selectContainerImageForGroup(group: RegisteredGroup): string {
  if (!isJarvisWorkerFolder(group.folder)) {
    return CONTAINER_IMAGE;
  }
  return shouldUseAgentRuntimeForWorkers()
    ? CONTAINER_IMAGE
    : WORKER_CONTAINER_IMAGE;
}

export function shouldStopSingleShotWorkerAgentRuntime(input: {
  groupFolder: string;
  image: string;
  result: ContainerOutput['result'];
  stopRequestedAfterResult: boolean;
}): boolean {
  return (
    isJarvisWorkerFolder(input.groupFolder) &&
    input.image === CONTAINER_IMAGE &&
    !!input.result &&
    !input.stopRequestedAfterResult
  );
}

const SINGLE_SHOT_WORKER_CLOSE_GRACE_MS = 15000;

function requestGracefulContainerClose(groupFolder: string): void {
  const inputDir = path.join(resolveGroupIpcPath(groupFolder), 'input');
  fs.mkdirSync(inputDir, { recursive: true });
  fs.writeFileSync(path.join(inputDir, '_close'), '');
}

function resolveGithubTokenForGroup(
  group: RegisteredGroup,
): string | undefined {
  const candidateKeys =
    group.folder === 'andy-developer'
      ? ['GITHUB_TOKEN_ANDY_DEVELOPER', 'GITHUB_TOKEN', 'GH_TOKEN']
      : group.folder === 'andy-bot'
        ? ['GITHUB_TOKEN_ANDY_BOT', 'GITHUB_TOKEN', 'GH_TOKEN']
        : isJarvisWorkerFolder(group.folder)
          ? ['GITHUB_TOKEN_WORKER', 'GITHUB_TOKEN', 'GH_TOKEN']
          : ['GITHUB_TOKEN', 'GH_TOKEN'];

  for (const key of candidateKeys) {
    const value = readSecretValue(key);
    if (value) return value;
  }
  return undefined;
}

function resolveContainerSecrets(
  group: RegisteredGroup,
): Record<string, string> {
  const resolved: Record<string, string> = {};

  const githubToken = resolveGithubTokenForGroup(group);
  if (githubToken) {
    resolved.GITHUB_TOKEN = githubToken;
    resolved.GH_TOKEN = githubToken;
  }

  for (const key of DEFAULT_MODEL_SECRET_KEYS) {
    const value = readSecretValue(key);
    if (value) {
      resolved[key] = value;
    }
  }

  for (const key of group.containerConfig?.secrets ?? []) {
    const value = readSecretValue(key);
    if (value) {
      resolved[key] = value;
    }
  }

  return resolved;
}

function isRetryableSkillSyncError(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  return code === 'ENOENT' || code === 'EBUSY' || code === 'EPERM';
}

function copySkillDirWithRetry(srcPath: string, dstPath: string): void {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      fs.cpSync(srcPath, dstPath, { recursive: true, dereference: true });
      return;
    } catch (err) {
      const retryable = isRetryableSkillSyncError(err);
      if (!retryable || attempt === maxAttempts) {
        throw err;
      }
      logger.warn(
        {
          err,
          srcPath,
          dstPath,
          attempt,
          maxAttempts,
        },
        'Retrying skill copy after transient filesystem race',
      );
    }
  }
}

function syncContainerSkills(skillsSrc: string, skillsDst: string): void {
  if (!fs.existsSync(skillsSrc)) return;

  fs.mkdirSync(skillsDst, { recursive: true });

  for (const entry of fs.readdirSync(skillsSrc, { withFileTypes: true })) {
    const entryName = typeof entry === 'string' ? entry : entry.name;
    // Hidden metadata folders (for example ".docs") can be self-referential.
    if (entryName.startsWith('.')) continue;

    const srcPath = path.join(skillsSrc, entryName);
    let isSymlink = false;
    try {
      isSymlink = fs.lstatSync(srcPath).isSymbolicLink();
    } catch (err) {
      logger.warn({ err, srcPath }, 'Failed to inspect skill source entry');
      continue;
    }
    if (isSymlink && !fs.existsSync(srcPath)) {
      logger.debug(
        { srcPath },
        'Skipping broken skill symlink during container skill sync',
      );
      continue;
    }

    let isDirectory = false;
    try {
      isDirectory = fs.statSync(srcPath).isDirectory();
    } catch (err) {
      logger.warn({ err, srcPath }, 'Failed to stat skill source entry');
      continue;
    }
    if (!isDirectory) continue;

    const dstPath = path.join(skillsDst, entryName);

    // Replace stale symlink destinations with real copied directories.
    if (fs.existsSync(dstPath)) {
      try {
        if (fs.lstatSync(dstPath).isSymbolicLink()) {
          fs.rmSync(dstPath, { force: true, recursive: true });
        }
      } catch (err) {
        logger.warn(
          { err, dstPath },
          'Failed to inspect skill destination entry',
        );
        continue;
      }
    }

    const srcReal = fs.realpathSync(srcPath);
    const dstReal = fs.existsSync(dstPath) ? fs.realpathSync(dstPath) : null;
    if (
      dstReal &&
      (srcReal === dstReal ||
        srcReal.startsWith(`${dstReal}${path.sep}`) ||
        dstReal.startsWith(`${srcReal}${path.sep}`))
    ) {
      logger.warn(
        { srcPath, dstPath, srcReal, dstReal },
        'Skipping overlapping skill copy',
      );
      continue;
    }

    try {
      copySkillDirWithRetry(srcPath, dstPath);
    } catch (err) {
      logger.warn({ err, srcPath, dstPath }, 'Failed to copy skill directory');
      throw err;
    }
  }
}

function hashDirectoryContents(dirPath: string): string {
  const hash = createHash('sha256');

  const visit = (currentPath: string, relativePrefix = ''): void => {
    const entries = fs
      .readdirSync(currentPath, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      const relativePath = relativePrefix
        ? `${relativePrefix}/${entry.name}`
        : entry.name;
      const fullPath = path.join(currentPath, entry.name);

      if (entry.isDirectory()) {
        hash.update(`dir:${relativePath}\n`);
        visit(fullPath, relativePath);
        continue;
      }

      if (!entry.isFile()) continue;

      hash.update(`file:${relativePath}\n`);
      hash.update(fs.readFileSync(fullPath));
      hash.update('\n');
    }
  };

  visit(dirPath);
  return hash.digest('hex');
}

function readAgentRunnerSyncMetadata(
  metadataPath: string,
): AgentRunnerSourceSyncMetadata | null {
  if (!fs.existsSync(metadataPath)) return null;

  try {
    const raw = JSON.parse(
      fs.readFileSync(metadataPath, 'utf8'),
    ) as Partial<AgentRunnerSourceSyncMetadata>;
    if (typeof raw.baselineHash !== 'string') return null;
    return {
      baselineHash: raw.baselineHash,
      syncedAt:
        typeof raw.syncedAt === 'string'
          ? raw.syncedAt
          : new Date(0).toISOString(),
    };
  } catch (err) {
    logger.warn(
      { err, metadataPath },
      'Failed to read agent-runner sync metadata',
    );
    return null;
  }
}

function writeAgentRunnerSyncMetadata(
  metadataPath: string,
  baselineHash: string,
): void {
  const metadata: AgentRunnerSourceSyncMetadata = {
    baselineHash,
    syncedAt: new Date().toISOString(),
  };
  writeJsonAtomic(metadataPath, metadata);
}

function replaceDirectory(srcPath: string, dstPath: string): void {
  fs.rmSync(dstPath, { recursive: true, force: true });
  fs.cpSync(srcPath, dstPath, { recursive: true });
}

function backupDirectory(dirPath: string): string {
  const backupPath = `${dirPath}.backup-${new Date()
    .toISOString()
    .replace(/[:.]/g, '-')}`;
  fs.cpSync(dirPath, backupPath, { recursive: true });
  return backupPath;
}

export function syncAgentRunnerSource(
  agentRunnerSrc: string,
  groupAgentRunnerDir: string,
  metadataPath = path.join(
    path.dirname(groupAgentRunnerDir),
    AGENT_RUNNER_SYNC_METADATA_FILENAME,
  ),
): void {
  if (!fs.existsSync(agentRunnerSrc)) return;

  fs.mkdirSync(path.dirname(groupAgentRunnerDir), { recursive: true });
  const repoBaselineHash = hashDirectoryContents(agentRunnerSrc);

  if (!fs.existsSync(groupAgentRunnerDir)) {
    fs.cpSync(agentRunnerSrc, groupAgentRunnerDir, { recursive: true });
    writeAgentRunnerSyncMetadata(metadataPath, repoBaselineHash);
    return;
  }

  const stagedHash = hashDirectoryContents(groupAgentRunnerDir);
  const metadata = readAgentRunnerSyncMetadata(metadataPath);

  if (metadata) {
    const stagedMatchesBaseline = stagedHash === metadata.baselineHash;
    const repoMatchesBaseline = repoBaselineHash === metadata.baselineHash;

    if (stagedMatchesBaseline) {
      if (!repoMatchesBaseline) {
        replaceDirectory(agentRunnerSrc, groupAgentRunnerDir);
        writeAgentRunnerSyncMetadata(metadataPath, repoBaselineHash);
      }
      return;
    }

    if (!repoMatchesBaseline) {
      logger.warn(
        {
          agentRunnerSrc,
          groupAgentRunnerDir,
          metadataPath,
          stagedHash,
          syncedBaselineHash: metadata.baselineHash,
          repoBaselineHash,
        },
        'Preserving locally customized staged agent-runner source after repo drift',
      );
    }
    return;
  }

  if (stagedHash === repoBaselineHash) {
    writeAgentRunnerSyncMetadata(metadataPath, repoBaselineHash);
    return;
  }

  const backupPath = backupDirectory(groupAgentRunnerDir);
  logger.warn(
    {
      agentRunnerSrc,
      groupAgentRunnerDir,
      metadataPath,
      backupPath,
      stagedHash,
      repoBaselineHash,
    },
    'Resetting legacy staged agent-runner source to repo baseline after backup',
  );
  replaceDirectory(agentRunnerSrc, groupAgentRunnerDir);
  writeAgentRunnerSyncMetadata(metadataPath, repoBaselineHash);
}

function buildVolumeMounts(
  group: RegisteredGroup,
  isMain: boolean,
): VolumeMount[] {
  const mounts: VolumeMount[] = [];
  const projectRoot = process.cwd();
  const groupDir = resolveGroupFolderPath(group.folder);
  const groupSessionRoot = path.join(DATA_DIR, 'sessions', group.folder);

  if (isMain) {
    // Main gets the project root read-only. Writable paths the agent needs
    // (group folder, IPC, .claude/) are mounted separately below.
    // Read-only prevents the agent from modifying host application code
    // (src/, dist/, package.json, etc.) which would bypass the sandbox
    // entirely on next restart.
    mounts.push({
      hostPath: projectRoot,
      containerPath: '/workspace/project',
      readonly: true,
    });

    // Shadow .env so the agent cannot read secrets from the mounted project root.
    // Credentials are injected by the credential proxy, never exposed to containers.
    const envFile = path.join(projectRoot, '.env');
    // Apple Container only supports directory bind mounts, so the /dev/null
    // file-shadow workaround is limited to runtimes that support file mounts.
    if (fs.existsSync(envFile) && CONTAINER_RUNTIME_BIN !== 'container') {
      mounts.push({
        hostPath: '/dev/null',
        containerPath: '/workspace/project/.env',
        readonly: true,
      });
    }

    // Main also gets its group folder as the working directory
    mounts.push({
      hostPath: groupDir,
      containerPath: '/workspace/group',
      readonly: false,
    });
  } else {
    // Other groups only get their own folder
    mounts.push({
      hostPath: groupDir,
      containerPath: '/workspace/group',
      readonly: false,
    });

    // Global memory directory (read-only for non-main)
    // Only directory mounts are supported, not file mounts
    const globalDir = path.join(GROUPS_DIR, 'global');
    if (fs.existsSync(globalDir)) {
      mounts.push({
        hostPath: globalDir,
        containerPath: '/workspace/global',
        readonly: true,
      });
    }
  }

  // Per-group Claude sessions directory (isolated from other groups)
  // Each group gets their own .claude/ to prevent cross-group session access
  const groupSessionsDir = path.join(groupSessionRoot, '.claude');
  fs.mkdirSync(groupSessionsDir, { recursive: true });
  const settingsFile = path.join(groupSessionsDir, 'settings.json');

  // Always-merge settings so hooks and env vars stay current on every start.
  let settings: Record<string, unknown> = {};
  if (fs.existsSync(settingsFile)) {
    try {
      settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8')) as Record<
        string,
        unknown
      >;
    } catch {
      // Corrupt settings file — start fresh
    }
  }

  // Ensure required env vars are present (existing values take precedence)
  const existingEnv =
    (settings.env as Record<string, string> | undefined) ?? {};
  settings.env = {
    // Enable agent swarms (subagent orchestration)
    // https://code.claude.com/docs/en/agent-teams#orchestrate-teams-of-claude-code-sessions
    CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1',
    // Load CLAUDE.md from additional mounted directories
    // https://code.claude.com/docs/en/memory#load-memory-from-additional-directories
    CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD: '1',
    // Enable Claude's memory feature (persists user preferences between sessions)
    // https://code.claude.com/docs/en/memory#manage-auto-memory
    CLAUDE_CODE_DISABLE_AUTO_MEMORY: '0',
    ...existingEnv,
  };

  // Inject PreToolUse dispatch validation hook for andy-developer only.
  // The hook blocks invalid dispatch payloads before they leave the container.
  if (group.folder === 'andy-developer') {
    const existingHooks =
      (settings.hooks as Record<string, unknown> | undefined) ?? {};
    const existingPreToolUse =
      (existingHooks.PreToolUse as unknown[] | undefined) ?? [];
    const validateDispatchHook = {
      matcher: 'mcp__nanoclaw__send_message',
      hooks: [
        {
          type: 'command',
          command: '/home/node/.claude/hooks/validate-dispatch.sh',
        },
        {
          type: 'command',
          command: '/home/node/.claude/hooks/validate-review-state-update.sh',
        },
      ],
    };
    const validateLinearIssueHook = {
      matcher: 'mcp__linear__save_issue',
      hooks: [
        {
          type: 'command',
          command: '/home/node/.claude/hooks/validate-linear-issue.sh',
        },
      ],
    };
    const validateLinearGraphqlHook = {
      matcher: 'mcp__linear__linear_graphql',
      hooks: [
        {
          type: 'command',
          command: '/home/node/.claude/hooks/validate-linear-graphql.sh',
        },
      ],
    };
    const requiredHooks = [
      validateDispatchHook,
      validateLinearIssueHook,
      validateLinearGraphqlHook,
    ];
    const missingHooks = requiredHooks.filter(
      (hook) =>
        !existingPreToolUse.some(
          (existingHook) =>
            JSON.stringify(existingHook) === JSON.stringify(hook),
        ),
    );
    settings.hooks = {
      ...existingHooks,
      PreToolUse:
        missingHooks.length === 0
          ? existingPreToolUse
          : [...existingPreToolUse, ...missingHooks],
    };
  }

  writeFileAtomic(settingsFile, JSON.stringify(settings, null, 2) + '\n');

  const mcpConfigFile = path.join(groupSessionsDir, '.mcp.json');
  let mcpConfig: SessionMcpConfig = {};
  if (fs.existsSync(mcpConfigFile)) {
    try {
      mcpConfig = JSON.parse(
        fs.readFileSync(mcpConfigFile, 'utf8'),
      ) as SessionMcpConfig;
    } catch {
      mcpConfig = {};
    }
  }
  const existingMcpServers = mcpConfig.mcpServers ?? {};
  mcpConfig.mcpServers = {
    ...existingMcpServers,
    notion: {
      command: 'mcp-remote',
      args: [
        `http://${CONTAINER_HOST_GATEWAY}:7802/mcp`,
        '--transport',
        'streamable-http',
      ],
    },
    linear: {
      command: 'mcp-remote',
      args: [
        `http://${CONTAINER_HOST_GATEWAY}:7803/mcp`,
        '--transport',
        'streamable-http',
      ],
    },
  };
  writeFileAtomic(mcpConfigFile, JSON.stringify(mcpConfig, null, 2) + '\n');

  // Sync hooks from groups/<folder>/.claude/hooks/ into sessions/<folder>/.claude/hooks/
  // This runs on every container start so updated scripts are always current.
  const hooksSrc = path.join(GROUPS_DIR, group.folder, '.claude', 'hooks');
  if (fs.existsSync(hooksSrc)) {
    const hooksDst = path.join(groupSessionsDir, 'hooks');
    fs.mkdirSync(hooksDst, { recursive: true });
    for (const entry of fs.readdirSync(hooksSrc, { withFileTypes: true })) {
      const entryName = typeof entry === 'string' ? entry : entry.name;
      const isFile = typeof entry === 'string' ? true : entry.isFile();
      if (!isFile) continue;
      const srcHookPath = path.join(hooksSrc, entryName);
      const dstHookPath = path.join(hooksDst, entryName);
      fs.copyFileSync(srcHookPath, dstHookPath);
      fs.chmodSync(dstHookPath, 0o755);
    }
  }

  const skillsDst = path.join(groupSessionsDir, 'skills');
  const skillSources = [
    path.join(process.cwd(), 'container', 'skills'),
    path.join(process.cwd(), '.claude', 'skills'),
  ];
  for (const skillsSrc of skillSources) {
    syncContainerSkills(skillsSrc, skillsDst);
  }
  mounts.push({
    hostPath: groupSessionsDir,
    containerPath: '/home/node/.claude',
    readonly: false,
  });

  // Per-group IPC namespace: each group gets its own IPC directory
  // This prevents cross-group privilege escalation via IPC
  const groupIpcDir = resolveGroupIpcPath(group.folder);
  fs.mkdirSync(path.join(groupIpcDir, 'messages'), { recursive: true });
  fs.mkdirSync(path.join(groupIpcDir, 'tasks'), { recursive: true });
  fs.mkdirSync(path.join(groupIpcDir, 'input'), { recursive: true });
  // Worker groups get steer/ and progress/ subdirs for bidirectional steering
  if (isJarvisWorkerFolder(group.folder)) {
    fs.mkdirSync(path.join(groupIpcDir, 'steer'), { recursive: true });
    fs.mkdirSync(path.join(groupIpcDir, 'progress'), { recursive: true });
  }
  mounts.push({
    hostPath: groupIpcDir,
    containerPath: '/workspace/ipc',
    readonly: false,
  });

  // Worker images expect the local MCP server bundle at /workspace/mcp-servers.
  // Mount it when present so OpenCode-backed lanes can start token-efficient
  // and other local MCP tools declared in OPENCODE_CONFIG_CONTENT.
  const mcpServersCandidates = [
    path.join(projectRoot, 'mcp-servers'),
    path.join(os.homedir(), 'Documents', 'remote-claude', 'mcp-servers'),
  ];
  const mcpServersDir = mcpServersCandidates.find((candidate) =>
    fs.existsSync(candidate),
  );
  if (mcpServersDir) {
    mounts.push({
      hostPath: mcpServersDir,
      containerPath: '/workspace/mcp-servers',
      readonly: true,
    });
  }

  // Stage agent-runner source into a per-group writable location so agents can
  // customize it without affecting other groups. The staged copy is baseline-
  // synced against the repo source on every launch.
  const agentRunnerSrc = path.join(
    projectRoot,
    'container',
    'agent-runner',
    'src',
  );
  const groupAgentRunnerDir = path.join(groupSessionRoot, 'agent-runner-src');
  syncAgentRunnerSource(agentRunnerSrc, groupAgentRunnerDir);
  mounts.push({
    hostPath: groupAgentRunnerDir,
    containerPath: '/app/src',
    readonly: false,
  });

  // Additional mounts validated against external allowlist (tamper-proof from containers)
  if (group.containerConfig?.additionalMounts) {
    const validatedMounts = validateAdditionalMounts(
      group.containerConfig.additionalMounts,
      group.name,
      isMain,
    );
    mounts.push(...validatedMounts);
  }

  return mounts;
}

function buildContainerArgs(
  mounts: VolumeMount[],
  containerName: string,
  image: string,
): string[] {
  const args: string[] = ['run', '-i', '--rm', '--name', containerName];

  // Pass host timezone so container's local time matches the user's
  args.push('-e', `TZ=${TIMEZONE}`);

  // Route API traffic through the credential proxy (containers never see real secrets)
  args.push(
    '-e',
    `ANTHROPIC_BASE_URL=http://${CONTAINER_HOST_GATEWAY}:${CREDENTIAL_PROXY_PORT}`,
  );

  // Mirror the host's auth method with a placeholder value.
  // API key mode: SDK sends x-api-key, proxy replaces with real key.
  // OAuth mode:   SDK exchanges placeholder token for temp API key,
  //               proxy injects real OAuth token on that exchange request.
  const authMode = detectAuthMode();
  if (authMode === 'api-key') {
    args.push('-e', 'ANTHROPIC_API_KEY=placeholder');
  } else {
    args.push('-e', 'CLAUDE_CODE_OAUTH_TOKEN=placeholder');
  }

  // Forward model override so containers use the same model as the host.
  // Required when the upstream proxy (e.g. minimax) maps a specific model name.
  if (process.env.ANTHROPIC_DEFAULT_SONNET_MODEL) {
    args.push(
      '-e',
      `ANTHROPIC_DEFAULT_SONNET_MODEL=${process.env.ANTHROPIC_DEFAULT_SONNET_MODEL}`,
    );
  }

  // Expose the resolved host gateway IP so the agent-runner can build correct MCP URLs.
  args.push('-e', `CONTAINER_HOST_GATEWAY=${CONTAINER_HOST_GATEWAY}`);

  // Runtime-specific args for host gateway resolution
  args.push(...hostGatewayArgs());

  // Apple Container runtime crashes with XPC "Connection interrupted"
  // when using --user. Let the image's default non-root user run instead.
  // Keep host-user mapping only for non-Apple runtimes.
  const supportsUserOverride = CONTAINER_RUNTIME_BIN !== 'container';
  if (supportsUserOverride) {
    // Run as host user so bind-mounted files are accessible.
    // Skip when running as root (uid 0), as the container's node user (uid 1000),
    // or when getuid is unavailable (native Windows without WSL).
    const hostUid = process.getuid?.();
    const hostGid = process.getgid?.();
    if (hostUid != null && hostUid !== 0 && hostUid !== 1000) {
      args.push('--user', `${hostUid}:${hostGid}`);
      args.push('-e', 'HOME=/home/node');
    }
  }

  for (const mount of mounts) {
    if (mount.readonly) {
      args.push(...readonlyMountArgs(mount.hostPath, mount.containerPath));
    } else {
      args.push('-v', `${mount.hostPath}:${mount.containerPath}`);
    }
  }

  args.push(image);

  return args;
}

export async function runContainerAgent(
  group: RegisteredGroup,
  input: ContainerInput,
  onProcess: (proc: ChildProcess, containerName: string) => void,
  onOutput?: (output: ContainerOutput) => Promise<void>,
): Promise<ContainerOutput> {
  const startTime = Date.now();
  const injectedSecrets = resolveContainerSecrets(group);
  const effectiveInput: ContainerInput =
    Object.keys(injectedSecrets).length > 0
      ? { ...input, secrets: injectedSecrets }
      : input;

  const groupDir = resolveGroupFolderPath(group.folder);
  fs.mkdirSync(groupDir, { recursive: true });

  const mounts = buildVolumeMounts(group, input.isMain);
  const safeName = group.folder.replace(/[^a-zA-Z0-9-]/g, '-');
  const groupPrefix = `nanoclaw-${safeName}-`;
  // A previous NanoClaw process can leave orphaned group containers alive.
  // Those orphans can consume IPC input from /workspace/ipc/<group>/input
  // without forwarding output back to the current host process.
  try {
    const { matched, stopped, failures } =
      stopRunningContainersByPrefix(groupPrefix);
    if (stopped.length > 0) {
      logger.info(
        { group: group.name, groupPrefix, stopped },
        'Stopped stale group containers before spawn',
      );
    }
    if (failures.length > 0) {
      logger.warn(
        { group: group.name, groupPrefix, matched, failures },
        'Failed to stop some stale group containers before spawn',
      );
    }
  } catch (err) {
    logger.warn(
      { group: group.name, groupPrefix, err },
      'Failed stale-container preflight; continuing with spawn',
    );
  }
  const containerName = `nanoclaw-${safeName}-${Date.now()}`;
  const image = selectContainerImageForGroup(group);
  const singleShotWorkerAgentRuntime =
    isJarvisWorkerFolder(group.folder) && image === CONTAINER_IMAGE;
  const containerArgs = buildContainerArgs(mounts, containerName, image);

  logger.debug(
    {
      group: group.name,
      containerName,
      mounts: mounts.map(
        (m) =>
          `${m.hostPath} -> ${m.containerPath}${m.readonly ? ' (ro)' : ''}`,
      ),
      containerArgs: containerArgs.join(' '),
    },
    'Container mount configuration',
  );

  logger.info(
    {
      group: group.name,
      containerName,
      mountCount: mounts.length,
      isMain: input.isMain,
    },
    'Spawning container agent',
  );

  const logsDir = path.join(groupDir, 'logs');
  fs.mkdirSync(logsDir, { recursive: true });

  return new Promise((resolve) => {
    const container = spawn(CONTAINER_RUNTIME_BIN, containerArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    onProcess(container, containerName);

    let stdout = '';
    let stderr = '';
    let stdoutTruncated = false;
    let stderrTruncated = false;

    container.stdin.write(JSON.stringify(effectiveInput));
    container.stdin.end();

    // Streaming output: parse OUTPUT_START/END marker pairs as they arrive
    let parseBuffer = '';
    let newSessionId: string | undefined;
    let sessionResumeStatus: ContainerOutput['sessionResumeStatus'];
    let sessionResumeError: string | undefined;
    let outputChain = Promise.resolve();
    const parseBufferLimit = CONTAINER_PARSE_BUFFER_LIMIT || 1024 * 1024;
    let stopRequestedAfterResult = false;
    let singleShotStopFallback: ReturnType<typeof setTimeout> | null = null;

    container.stdout.on('data', (data) => {
      const chunk = data.toString();

      // Always accumulate for logging
      if (!stdoutTruncated) {
        const remaining = CONTAINER_MAX_OUTPUT_SIZE - stdout.length;
        if (chunk.length > remaining) {
          stdout += chunk.slice(0, remaining);
          stdoutTruncated = true;
          logger.warn(
            { group: group.name, size: stdout.length },
            'Container stdout truncated due to size limit',
          );
        } else {
          stdout += chunk;
        }
      }

      // Stream-parse for output markers
      if (onOutput) {
        parseBuffer += chunk;

        // Fail-fast: if parseBuffer exceeds limit with incomplete markers, abort
        if (parseBuffer.length > parseBufferLimit) {
          const hasStartMarker = parseBuffer.includes(OUTPUT_START_MARKER);
          const hasEndMarker = parseBuffer.includes(OUTPUT_END_MARKER);
          if (hasStartMarker && !hasEndMarker) {
            logger.error(
              { group: group.name, bufferSize: parseBuffer.length },
              'Parse buffer exceeded limit with incomplete markers, aborting container',
            );
            container.kill('SIGKILL');
            return;
          }
          // Buffer overflow - trim oldest data to prevent unbounded growth
          parseBuffer = parseBuffer.slice(-parseBufferLimit / 2);
        }

        let startIdx: number;
        while ((startIdx = parseBuffer.indexOf(OUTPUT_START_MARKER)) !== -1) {
          const endIdx = parseBuffer.indexOf(OUTPUT_END_MARKER, startIdx);
          if (endIdx === -1) break; // Incomplete pair, wait for more data

          const jsonStr = parseBuffer
            .slice(startIdx + OUTPUT_START_MARKER.length, endIdx)
            .trim();
          parseBuffer = parseBuffer.slice(endIdx + OUTPUT_END_MARKER.length);

          try {
            const parsed: ContainerOutput = JSON.parse(jsonStr);
            if (parsed.newSessionId) {
              newSessionId = parsed.newSessionId;
            }
            if (parsed.sessionResumeStatus) {
              sessionResumeStatus = parsed.sessionResumeStatus;
            }
            if (parsed.sessionResumeError) {
              sessionResumeError = parsed.sessionResumeError;
            }
            if (!hadStreamingOutput) {
              hadStreamingOutput = true;
              if (noOutputTimeout) {
                clearTimeout(noOutputTimeout);
                noOutputTimeout = null;
              }
            }
            // Call onOutput for all markers (including null results)
            // so idle timers start even for "silent" query completions.
            outputChain = outputChain.then(() => onOutput(parsed));
            if (
              shouldStopSingleShotWorkerAgentRuntime({
                groupFolder: group.folder,
                image,
                result: parsed.result,
                stopRequestedAfterResult,
              })
            ) {
              stopRequestedAfterResult = true;
              outputChain = outputChain.then(
                () =>
                  new Promise<void>((stopResolved) => {
                    logger.info(
                      { group: group.name, containerName },
                      'Gracefully closing single-shot worker agent runtime after first result',
                    );
                    try {
                      requestGracefulContainerClose(group.folder);
                    } catch (err) {
                      logger.warn(
                        { group: group.name, containerName, err },
                        'Failed to write close sentinel for single-shot worker runtime',
                      );
                    }
                    if (singleShotStopFallback) {
                      clearTimeout(singleShotStopFallback);
                    }
                    singleShotStopFallback = setTimeout(() => {
                      exec(
                        stopContainer(containerName),
                        { timeout: 15000 },
                        (err) => {
                          if (err) {
                            logger.warn(
                              { group: group.name, containerName, err },
                              'Failed to stop single-shot worker agent runtime after grace window',
                            );
                          }
                        },
                      );
                    }, SINGLE_SHOT_WORKER_CLOSE_GRACE_MS);
                    stopResolved();
                  }),
              );
            }
          } catch (err) {
            logger.warn(
              { group: group.name, error: err },
              'Failed to parse streamed output chunk',
            );
          }
        }
      }
    });

    container.stderr.on('data', (data) => {
      const chunk = data.toString();
      const lines = chunk.trim().split('\n');
      for (const line of lines) {
        if (line) logger.debug({ container: group.folder }, line);
      }
      // Re-arm no_output_timeout on our own [agent-runner] instrumentation lines
      // (heartbeats, status logs) but NOT on SDK debug spam.
      if (noOutputTimeout && shouldTreatAgentRunnerStderrAsProgress(chunk)) {
        clearTimeout(noOutputTimeout);
        noOutputTimeout = setTimeout(
          () => stopForTimeout('no_output_timeout'),
          configuredNoOutputTimeout,
        );
      }
      if (stderrTruncated) return;
      const remaining = CONTAINER_MAX_OUTPUT_SIZE - stderr.length;
      if (chunk.length > remaining) {
        stderr += chunk.slice(0, remaining);
        stderrTruncated = true;
        logger.warn(
          { group: group.name, size: stderr.length },
          'Container stderr truncated due to size limit',
        );
      } else {
        stderr += chunk;
      }
    });

    let timedOut = false;
    let hadStreamingOutput = false;
    let timeoutReason: 'no_output_timeout' | 'hard_timeout' | null = null;
    const configuredIdleTimeout =
      group.containerConfig?.idleTimeout || IDLE_TIMEOUT;
    const requestedNoOutputTimeout =
      group.containerConfig?.noOutputTimeout || CONTAINER_NO_OUTPUT_TIMEOUT;
    const configuredNoOutputTimeout = isJarvisWorkerFolder(group.folder)
      ? Math.max(requestedNoOutputTimeout, WORKER_MIN_NO_OUTPUT_TIMEOUT_MS)
      : requestedNoOutputTimeout;
    const configuredHardTimeout =
      group.containerConfig?.timeout || CONTAINER_TIMEOUT;
    if (configuredNoOutputTimeout !== requestedNoOutputTimeout) {
      logger.info(
        {
          group: group.name,
          folder: group.folder,
          requestedNoOutputTimeout,
          effectiveNoOutputTimeout: configuredNoOutputTimeout,
          minWorkerNoOutputTimeout: WORKER_MIN_NO_OUTPUT_TIMEOUT_MS,
        },
        'Raised worker no-output timeout to minimum safety floor',
      );
    }
    // Grace period: hard timeout must be at least idle timeout + 30s so the
    // graceful _close sentinel has time to trigger before the hard kill fires.
    const hardTimeoutMs = Math.max(
      configuredHardTimeout,
      configuredIdleTimeout + 30_000,
    );

    const stopForTimeout = (reason: 'no_output_timeout' | 'hard_timeout') => {
      if (timedOut) return;
      timedOut = true;
      timeoutReason = reason;
      logger.error(
        { group: group.name, containerName, timeoutReason: reason },
        'Container timeout, stopping gracefully',
      );
      exec(stopContainer(containerName), { timeout: 15000 }, (err) => {
        if (err) {
          logger.warn(
            { group: group.name, containerName, err },
            'Graceful stop failed, force killing',
          );
          container.kill('SIGKILL');
        }
      });
    };

    const hardTimeout = setTimeout(
      () => stopForTimeout('hard_timeout'),
      hardTimeoutMs,
    );
    let noOutputTimeout: ReturnType<typeof setTimeout> | null = null;
    if (configuredNoOutputTimeout > 0) {
      noOutputTimeout = setTimeout(
        () => stopForTimeout('no_output_timeout'),
        configuredNoOutputTimeout,
      );
    }

    container.on('close', (code) => {
      if (singleShotStopFallback) {
        clearTimeout(singleShotStopFallback);
        singleShotStopFallback = null;
      }
      clearTimeout(hardTimeout);
      if (noOutputTimeout) clearTimeout(noOutputTimeout);
      const duration = Date.now() - startTime;

      if (timedOut) {
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        const timeoutLog = path.join(logsDir, `container-${ts}.log`);
        writeFileAtomic(
          timeoutLog,
          [
            `=== Container Run Log (TIMEOUT) ===`,
            `Timestamp: ${new Date().toISOString()}`,
            `Group: ${group.name}`,
            `Container: ${containerName}`,
            `Duration: ${duration}ms`,
            `Exit Code: ${code}`,
            `Timeout Reason: ${timeoutReason || 'unknown'}`,
            `Configured Hard Timeout: ${configuredHardTimeout}ms`,
            `Configured No-Output Timeout: ${configuredNoOutputTimeout}ms`,
            `Configured Idle Timeout: ${configuredIdleTimeout}ms`,
            `Effective Hard Timeout: ${hardTimeoutMs}ms`,
            `Had Streaming Output: ${hadStreamingOutput}`,
          ].join('\n'),
        );

        // Timeout after output = idle cleanup, not failure.
        // The agent already sent its response; this is just the
        // container being reaped after the idle period expired.
        if (hadStreamingOutput) {
          logger.info(
            { group: group.name, containerName, duration, code },
            'Container timed out after output (idle cleanup)',
          );
          outputChain.then(() => {
            resolve({
              status: 'success',
              result: null,
              newSessionId,
              sessionResumeStatus,
              sessionResumeError,
            });
          });
          return;
        }

        logger.error(
          { group: group.name, containerName, duration, code, timeoutReason },
          'Container timed out with no output',
        );

        resolve({
          status: 'error',
          result: null,
          error:
            timeoutReason === 'no_output_timeout'
              ? `Container timed out (no_output_timeout after ${configuredNoOutputTimeout}ms)`
              : `Container timed out (hard_timeout after ${hardTimeoutMs}ms)`,
        });
        return;
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const logFile = path.join(logsDir, `container-${timestamp}.log`);
      const isVerbose =
        process.env.LOG_LEVEL === 'debug' || process.env.LOG_LEVEL === 'trace';

      const logLines = [
        `=== Container Run Log ===`,
        `Timestamp: ${new Date().toISOString()}`,
        `Group: ${group.name}`,
        `IsMain: ${input.isMain}`,
        `Duration: ${duration}ms`,
        `Exit Code: ${code}`,
        `Stdout Truncated: ${stdoutTruncated}`,
        `Stderr Truncated: ${stderrTruncated}`,
        ``,
      ];

      const isError = code !== 0;

      if (isVerbose || isError) {
        logLines.push(
          `=== Input ===`,
          JSON.stringify(input, null, 2),
          ``,
          `=== Container Image ===`,
          image,
          ``,
          `=== Container Args ===`,
          containerArgs.join(' '),
          ``,
          `=== Mounts ===`,
          mounts
            .map(
              (m) =>
                `${m.hostPath} -> ${m.containerPath}${m.readonly ? ' (ro)' : ''}`,
            )
            .join('\n'),
          ``,
          `=== Stderr${stderrTruncated ? ' (TRUNCATED)' : ''} ===`,
          stderr,
          ``,
          `=== Stdout${stdoutTruncated ? ' (TRUNCATED)' : ''} ===`,
          stdout,
        );
      } else {
        logLines.push(
          `=== Input Summary ===`,
          `Prompt length: ${input.prompt.length} chars`,
          `Session ID: ${input.sessionId || 'new'}`,
          `Container Image: ${image}`,
          ``,
          `=== Mounts ===`,
          mounts
            .map((m) => `${m.containerPath}${m.readonly ? ' (ro)' : ''}`)
            .join('\n'),
          ``,
        );
      }

      fs.writeFileSync(logFile, logLines.join('\n'));
      logger.debug({ logFile, verbose: isVerbose }, 'Container log written');

      if (code !== 0) {
        logger.error(
          {
            group: group.name,
            code,
            duration,
            stderr,
            stdout,
            logFile,
          },
          'Container exited with error',
        );

        resolve({
          status: 'error',
          result: null,
          error: `Container exited with code ${code}: ${stderr.slice(-200)}`,
        });
        return;
      }

      // Streaming mode: wait for output chain to settle, return completion marker
      if (onOutput) {
        outputChain.then(() => {
          logger.info(
            { group: group.name, duration, newSessionId },
            'Container completed (streaming mode)',
          );
          resolve({
            status: 'success',
            result: null,
            newSessionId,
            sessionResumeStatus,
            sessionResumeError,
          });
        });
        return;
      }

      // Legacy mode: parse the last output marker pair from accumulated stdout
      try {
        // Extract JSON between sentinel markers for robust parsing
        const startIdx = stdout.indexOf(OUTPUT_START_MARKER);
        const endIdx = stdout.indexOf(OUTPUT_END_MARKER);

        let jsonLine: string;
        if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
          jsonLine = stdout
            .slice(startIdx + OUTPUT_START_MARKER.length, endIdx)
            .trim();
        } else {
          // Fallback: last non-empty line (backwards compatibility)
          const lines = stdout.trim().split('\n');
          jsonLine = lines[lines.length - 1];
        }

        const output: ContainerOutput = JSON.parse(jsonLine);

        logger.info(
          {
            group: group.name,
            duration,
            status: output.status,
            hasResult: !!output.result,
          },
          'Container completed',
        );

        resolve(output);
      } catch (err) {
        logger.error(
          {
            group: group.name,
            stdout,
            stderr,
            error: err,
          },
          'Failed to parse container output',
        );

        resolve({
          status: 'error',
          result: null,
          error: `Failed to parse container output: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    });

    container.on('error', (err) => {
      clearTimeout(hardTimeout);
      if (noOutputTimeout) clearTimeout(noOutputTimeout);
      logger.error(
        { group: group.name, containerName, error: err },
        'Container spawn error',
      );
      resolve({
        status: 'error',
        result: null,
        error: `Container spawn error: ${err.message}`,
      });
    });
  });
}

export function writeTasksSnapshot(
  groupFolder: string,
  isMain: boolean,
  tasks: Array<{
    id: string;
    groupFolder: string;
    prompt: string;
    schedule_type: string;
    schedule_value: string;
    status: string;
    next_run: string | null;
  }>,
): void {
  // Write filtered tasks to the group's IPC directory
  const groupIpcDir = resolveGroupIpcPath(groupFolder);
  fs.mkdirSync(groupIpcDir, { recursive: true });

  // Main sees all tasks, others only see their own
  const filteredTasks = isMain
    ? tasks
    : tasks.filter((t) => t.groupFolder === groupFolder);

  const tasksFile = path.join(groupIpcDir, 'current_tasks.json');
  writeJsonAtomic(tasksFile, filteredTasks);
}

export interface AvailableGroup {
  jid: string;
  name: string;
  lastActivity: string;
  isRegistered: boolean;
}

export interface WorkerRunSnapshotEntry {
  run_id: string;
  group_folder: string;
  status: string;
  phase?: string | null;
  started_at: string;
  completed_at: string | null;
  retry_count: number;
  result_summary: string | null;
  error_details: string | null;
  dispatch_repo?: string | null;
  dispatch_branch?: string | null;
  context_intent?: string | null;
  parent_run_id?: string | null;
  dispatch_session_id?: string | null;
  selected_session_id?: string | null;
  effective_session_id?: string | null;
  session_selection_source?: string | null;
  session_resume_status?: string | null;
  session_resume_error?: string | null;
  last_heartbeat_at?: string | null;
  active_container_name?: string | null;
  no_container_since?: string | null;
  expects_followup_container?: number | null;
  supervisor_owner?: string | null;
  lease_expires_at?: string | null;
  recovered_from_reason?: string | null;
}

export interface DispatchBlockSnapshotEntry {
  timestamp: string;
  source_group: string;
  target_jid: string;
  target_folder?: string;
  reason_code: string;
  reason_text: string;
  run_id?: string;
}

export interface WorkerRunsSnapshot {
  generated_at: string;
  scope: 'all' | 'jarvis' | 'group';
  active: WorkerRunSnapshotEntry[];
  recent: WorkerRunSnapshotEntry[];
  dispatch_blocks?: DispatchBlockSnapshotEntry[];
}

/**
 * Write available groups snapshot for the container to read.
 * Only main group can see all available groups (for activation).
 * Non-main groups only see their own registration status.
 */
export function writeGroupsSnapshot(
  groupFolder: string,
  isMain: boolean,
  groups: AvailableGroup[],
  registeredJids: Set<string>,
): void {
  const groupIpcDir = resolveGroupIpcPath(groupFolder);
  fs.mkdirSync(groupIpcDir, { recursive: true });

  // Main sees all groups; others see nothing (they can't activate groups)
  const visibleGroups = isMain ? groups : [];

  const groupsFile = path.join(groupIpcDir, 'available_groups.json');
  writeJsonAtomic(groupsFile, {
    groups: visibleGroups,
    lastSync: new Date().toISOString(),
  });
}

export function writeWorkerRunsSnapshot(
  groupFolder: string,
  snapshot: WorkerRunsSnapshot,
): void {
  const groupIpcDir = resolveGroupIpcPath(groupFolder);
  fs.mkdirSync(groupIpcDir, { recursive: true });

  const workerRunsFile = path.join(groupIpcDir, 'worker_runs.json');
  writeJsonAtomic(workerRunsFile, snapshot);
}
