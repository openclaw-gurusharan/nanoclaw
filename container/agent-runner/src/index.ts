/**
 * NanoClaw Agent Runner
 * Runs inside a container, receives config via stdin, outputs result to stdout
 *
 * Input protocol:
 *   Stdin: Full ContainerInput JSON (read until EOF, like before)
 *   IPC:   Follow-up messages written as JSON files to /workspace/ipc/input/
 *          Files: {type:"message", text:"..."}.json — polled and consumed
 *          Sentinel: /workspace/ipc/input/_close — signals session end
 *
 * Stdout protocol:
 *   Each result is wrapped in OUTPUT_START_MARKER / OUTPUT_END_MARKER pairs.
 *   Multiple results may be emitted (one per agent teams result).
 *   Final marker after loop ends signals completion.
 */

import fs from 'fs';
import path from 'path';
import { query, HookCallback, PreCompactHookInput, PreToolUseHookInput } from '@anthropic-ai/claude-agent-sdk';
import { fileURLToPath } from 'url';

interface ContainerInput {
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

interface ContainerOutput {
  status: 'success' | 'error';
  result: string | null;
  newSessionId?: string;
  sessionResumeStatus?: 'resumed' | 'fallback_new' | 'new';
  sessionResumeError?: string;
  error?: string;
}

type AuthMode = 'oauth' | 'apiKey' | 'auto';

interface SessionEntry {
  sessionId: string;
  fullPath: string;
  summary: string;
  firstPrompt: string;
}

interface SessionsIndex {
  entries: SessionEntry[];
}

interface SDKUserMessage {
  type: 'user';
  message: { role: 'user'; content: string };
  parent_tool_use_id: null;
  session_id: string;
}

const IPC_INPUT_DIR = '/workspace/ipc/input';
const IPC_INPUT_CLOSE_SENTINEL = path.join(IPC_INPUT_DIR, '_close');
const IPC_PROGRESS_DIR = '/workspace/ipc/progress';
const IPC_STEER_DIR = '/workspace/ipc/steer';
const IPC_POLL_MS = 500;
const PROGRESS_THROTTLE_MS = 5000;
const OAUTH_FALLBACK_GROUPS = new Set(['main', 'andy-developer']);

interface WorkerProgressEvent {
  kind: 'worker_progress';
  run_id: string;
  group_folder: string;
  timestamp: string;
  phase: string;
  summary: string;
  tool_used?: string;
  seq: number;
}

interface WorkerSteerEvent {
  kind: 'worker_steer';
  run_id: string;
  from_group: string;
  timestamp: string;
  message: string;
  steer_id: string;
}
const OAUTH_LIMIT_PATTERNS = [
  /you['’]?ve hit your limit/i,
  /\bmonthly usage limit\b/i,
  /\bupgrade to (pro|max)\b/i,
  /\bsubscription limit\b/i,
  /\brate limit\b/i,
  /\btoo many requests\b/i,
];

/**
 * Push-based async iterable for streaming user messages to the SDK.
 * Keeps the iterable alive until end() is called, preventing isSingleUserTurn.
 */
class MessageStream {
  private queue: SDKUserMessage[] = [];
  private waiting: (() => void) | null = null;
  private done = false;

  push(text: string): void {
    this.queue.push({
      type: 'user',
      message: { role: 'user', content: text },
      parent_tool_use_id: null,
      session_id: '',
    });
    this.waiting?.();
  }

  end(): void {
    this.done = true;
    this.waiting?.();
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<SDKUserMessage> {
    while (true) {
      while (this.queue.length > 0) {
        yield this.queue.shift()!;
      }
      if (this.done) return;
      await new Promise<void>(r => { this.waiting = r; });
      this.waiting = null;
    }
  }
}

async function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

const OUTPUT_START_MARKER = '---NANOCLAW_OUTPUT_START---';
const OUTPUT_END_MARKER = '---NANOCLAW_OUTPUT_END---';

function writeOutput(output: ContainerOutput): void {
  console.log(OUTPUT_START_MARKER);
  console.log(JSON.stringify(output));
  console.log(OUTPUT_END_MARKER);
}

function canUseApiFallback(groupFolder: string): boolean {
  // Jarvis worker lanes run via OpenCode and must never use Anthropic API fallback.
  if (groupFolder.startsWith('jarvis-worker')) return false;
  return OAUTH_FALLBACK_GROUPS.has(groupFolder);
}

function isFallbackToggleEnabled(secrets: Record<string, string>): boolean {
  const raw = secrets.OAUTH_API_FALLBACK_ENABLED;
  if (!raw) return true; // Backwards-compatible default.
  return raw.trim().toLowerCase() !== 'false';
}

function isOAuthLimitMessage(text: string): boolean {
  const normalized = text.trim();
  if (!normalized) return false;
  return OAUTH_LIMIT_PATTERNS.some((pattern) => pattern.test(normalized));
}

function isSessionResumeErrorMessage(text: string): boolean {
  const normalized = text.trim();
  if (!normalized) return false;
  return (
    /(resume|session)/i.test(normalized)
    && /(not found|unknown|invalid|does not exist|failed|cannot|unable|missing)/i.test(normalized)
  );
}

function selectInitialAuthMode(
  groupFolder: string,
  secrets: Record<string, string>,
): AuthMode {
  const hasOauth = !!secrets.CLAUDE_CODE_OAUTH_TOKEN;
  const hasApiKey = !!secrets.ANTHROPIC_API_KEY;
  const laneSupportsSwitch = canUseApiFallback(groupFolder);
  const preferApiLane = laneSupportsSwitch && isFallbackToggleEnabled(secrets);

  if (laneSupportsSwitch) {
    if (preferApiLane && hasApiKey) return 'apiKey';
    if (!preferApiLane && hasOauth) return 'oauth';
  }

  const allowFallback = laneSupportsSwitch && !preferApiLane;
  if (hasOauth && hasApiKey && allowFallback) return 'oauth';
  if (hasOauth) return 'oauth';
  if (hasApiKey) return 'apiKey';
  return 'auto';
}

function buildSdkEnv(
  baseEnv: NodeJS.ProcessEnv,
  secrets: Record<string, string>,
  authMode: AuthMode,
  groupFolder: string,
): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...baseEnv };
  delete env.CLAUDE_CODE_OAUTH_TOKEN;
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_BASE_URL;

  const oauth = secrets.CLAUDE_CODE_OAUTH_TOKEN;
  const apiKey = secrets.ANTHROPIC_API_KEY;
  const anthropicBaseUrl = secrets.ANTHROPIC_BASE_URL;
  const fallbackEnabled = isFallbackToggleEnabled(secrets);
  const laneKey = groupFolder.toUpperCase().replace(/[^A-Z0-9]+/g, '_');
  const laneGithub = secrets[`GITHUB_TOKEN_${laneKey}`] || secrets[`GH_TOKEN_${laneKey}`];
  const globalGithub = secrets.GITHUB_TOKEN || secrets.GH_TOKEN;
  const githubToken = laneGithub || globalGithub;
  if (githubToken) {
    env.GITHUB_TOKEN = githubToken;
    env.GH_TOKEN = githubToken;
  }

  if (authMode === 'oauth') {
    if (oauth) env.CLAUDE_CODE_OAUTH_TOKEN = oauth;
    return env;
  }

  if (authMode === 'apiKey') {
    if (apiKey) env.ANTHROPIC_API_KEY = apiKey;
    if (anthropicBaseUrl && fallbackEnabled) env.ANTHROPIC_BASE_URL = anthropicBaseUrl;
    return env;
  }

  if (oauth) env.CLAUDE_CODE_OAUTH_TOKEN = oauth;
  if (apiKey) env.ANTHROPIC_API_KEY = apiKey;
  if (anthropicBaseUrl && fallbackEnabled) env.ANTHROPIC_BASE_URL = anthropicBaseUrl;
  return env;
}

function selectModelForQuery(
  secrets: Record<string, string>,
  authMode: AuthMode,
): string | undefined {
  if (authMode !== 'apiKey') return undefined;
  const model = secrets.ANTHROPIC_DEFAULT_SONNET_MODEL?.trim();
  if (!model) return undefined;
  return model;
}

// Must match AGENT_RUNNER_LOG_PREFIX in src/container-runner.ts (host side)
const AGENT_RUNNER_LOG_PREFIX = '[agent-runner]';

function log(message: string): void {
  console.error(`${AGENT_RUNNER_LOG_PREFIX} ${message}`);
}

function writeProgressEvent(event: WorkerProgressEvent): void {
  const runDir = path.join(IPC_PROGRESS_DIR, event.run_id);
  try {
    fs.mkdirSync(runDir, { recursive: true });
    const filename = `${event.timestamp.replace(/[:.]/g, '-')}-${event.seq}.json`;
    fs.writeFileSync(path.join(runDir, filename), JSON.stringify(event));
  } catch (err) {
    // Non-fatal: don't fail the run if progress write fails
    log(`Progress write failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function checkForSteering(runId: string): string | null {
  const steerPath = path.join(IPC_STEER_DIR, `${runId}.json`);
  if (!fs.existsSync(steerPath)) return null;
  try {
    const event = JSON.parse(fs.readFileSync(steerPath, 'utf-8')) as WorkerSteerEvent;
    // Write ack so host knows it was consumed
    fs.writeFileSync(
      path.join(IPC_STEER_DIR, `${runId}.acked.json`),
      JSON.stringify({ steer_id: event.steer_id, acked_at: new Date().toISOString() }),
    );
    try { fs.unlinkSync(steerPath); } catch { /* ignore */ }
    log(`Steering received (steer_id=${event.steer_id}): ${event.message.slice(0, 100)}`);
    return event.message;
  } catch (err) {
    log(`Failed to read steer event: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

function getSessionSummary(sessionId: string, transcriptPath: string): string | null {
  const projectDir = path.dirname(transcriptPath);
  const indexPath = path.join(projectDir, 'sessions-index.json');

  if (!fs.existsSync(indexPath)) {
    log(`Sessions index not found at ${indexPath}`);
    return null;
  }

  try {
    const index: SessionsIndex = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
    const entry = index.entries.find(e => e.sessionId === sessionId);
    if (entry?.summary) {
      return entry.summary;
    }
  } catch (err) {
    log(`Failed to read sessions index: ${err instanceof Error ? err.message : String(err)}`);
  }

  return null;
}

/**
 * Archive the full transcript to conversations/ before compaction.
 */
function createPreCompactHook(assistantName?: string): HookCallback {
  return async (input, _toolUseId, _context) => {
    const preCompact = input as PreCompactHookInput;
    const transcriptPath = preCompact.transcript_path;
    const sessionId = preCompact.session_id;

    if (!transcriptPath || !fs.existsSync(transcriptPath)) {
      log('No transcript found for archiving');
      return {};
    }

    try {
      const content = fs.readFileSync(transcriptPath, 'utf-8');
      const messages = parseTranscript(content);

      if (messages.length === 0) {
        log('No messages to archive');
        return {};
      }

      const summary = getSessionSummary(sessionId, transcriptPath);
      const name = summary ? sanitizeFilename(summary) : generateFallbackName();

      const conversationsDir = '/workspace/group/conversations';
      fs.mkdirSync(conversationsDir, { recursive: true });

      const date = new Date().toISOString().split('T')[0];
      const filename = `${date}-${name}.md`;
      const filePath = path.join(conversationsDir, filename);

      const markdown = formatTranscriptMarkdown(messages, summary, assistantName);
      fs.writeFileSync(filePath, markdown);

      log(`Archived conversation to ${filePath}`);
    } catch (err) {
      log(`Failed to archive transcript: ${err instanceof Error ? err.message : String(err)}`);
    }

    return {};
  };
}

// Secrets to strip from Bash tool subprocess environments.
// These are needed by claude-code for API auth but should never
// be visible to commands Kit runs.
const SECRET_ENV_VARS = ['ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN'];

function createSanitizeBashHook(): HookCallback {
  return async (input, _toolUseId, _context) => {
    const preInput = input as PreToolUseHookInput;
    const command = (preInput.tool_input as { command?: string })?.command;
    if (!command) return {};

    const unsetPrefix = `unset ${SECRET_ENV_VARS.join(' ')} 2>/dev/null; `;
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        updatedInput: {
          ...(preInput.tool_input as Record<string, unknown>),
          command: unsetPrefix + command,
        },
      },
    };
  };
}

function sanitizeFilename(summary: string): string {
  return summary
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

function generateFallbackName(): string {
  const time = new Date();
  return `conversation-${time.getHours().toString().padStart(2, '0')}${time.getMinutes().toString().padStart(2, '0')}`;
}

interface ParsedMessage {
  role: 'user' | 'assistant';
  content: string;
}

function parseTranscript(content: string): ParsedMessage[] {
  const messages: ParsedMessage[] = [];

  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      if (entry.type === 'user' && entry.message?.content) {
        const text = typeof entry.message.content === 'string'
          ? entry.message.content
          : entry.message.content.map((c: { text?: string }) => c.text || '').join('');
        if (text) messages.push({ role: 'user', content: text });
      } else if (entry.type === 'assistant' && entry.message?.content) {
        const textParts = entry.message.content
          .filter((c: { type: string }) => c.type === 'text')
          .map((c: { text: string }) => c.text);
        const text = textParts.join('');
        if (text) messages.push({ role: 'assistant', content: text });
      }
    } catch {
    }
  }

  return messages;
}

function formatTranscriptMarkdown(messages: ParsedMessage[], title?: string | null, assistantName?: string): string {
  const now = new Date();
  const formatDateTime = (d: Date) => d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });

  const lines: string[] = [];
  lines.push(`# ${title || 'Conversation'}`);
  lines.push('');
  lines.push(`Archived: ${formatDateTime(now)}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  for (const msg of messages) {
    const sender = msg.role === 'user' ? 'User' : (assistantName || 'Assistant');
    const content = msg.content.length > 2000
      ? msg.content.slice(0, 2000) + '...'
      : msg.content;
    lines.push(`**${sender}**: ${content}`);
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Check for _close sentinel.
 */
function shouldClose(): boolean {
  if (fs.existsSync(IPC_INPUT_CLOSE_SENTINEL)) {
    try { fs.unlinkSync(IPC_INPUT_CLOSE_SENTINEL); } catch { /* ignore */ }
    return true;
  }
  return false;
}

/**
 * Drain all pending IPC input messages.
 * Returns messages found, or empty array.
 */
function drainIpcInput(): string[] {
  try {
    fs.mkdirSync(IPC_INPUT_DIR, { recursive: true });
    const files = fs.readdirSync(IPC_INPUT_DIR)
      .filter(f => f.endsWith('.json'))
      .sort();

    const messages: string[] = [];
    for (const file of files) {
      const filePath = path.join(IPC_INPUT_DIR, file);
      try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        fs.unlinkSync(filePath);
        if (data.type === 'message' && data.text) {
          messages.push(data.text);
        }
      } catch (err) {
        log(`Failed to process input file ${file}: ${err instanceof Error ? err.message : String(err)}`);
        try { fs.unlinkSync(filePath); } catch { /* ignore */ }
      }
    }
    return messages;
  } catch (err) {
    log(`IPC drain error: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

/**
 * Wait for a new IPC message or _close sentinel.
 * Returns the messages as a single string, or null if _close.
 */
function waitForIpcMessage(): Promise<string | null> {
  return new Promise((resolve) => {
    const poll = () => {
      if (shouldClose()) {
        resolve(null);
        return;
      }
      const messages = drainIpcInput();
      if (messages.length > 0) {
        resolve(messages.join('\n'));
        return;
      }
      setTimeout(poll, IPC_POLL_MS);
    };
    poll();
  });
}

/**
 * Run a single query and stream results via writeOutput.
 * Uses MessageStream (AsyncIterable) to keep isSingleUserTurn=false,
 * allowing agent teams subagents to run to completion.
 * Also pipes IPC messages into the stream during the query.
 */
async function runQuery(
  prompt: string,
  sessionId: string | undefined,
  mcpServerPath: string,
  containerInput: ContainerInput,
  sdkEnv: Record<string, string | undefined>,
  authMode: AuthMode,
  model: string | undefined,
  allowApiFallback: boolean,
  sessionResumeStatus: ContainerOutput['sessionResumeStatus'],
  sessionResumeError?: string,
  resumeAt?: string,
  runId?: string,
): Promise<{
  newSessionId?: string;
  lastAssistantUuid?: string;
  closedDuringQuery: boolean;
  fallbackRequested: boolean;
}> {
  const stream = new MessageStream();
  stream.push(prompt);

  // Progress emission state (throttled per runId)
  let progressSeq = 0;
  let lastProgressAt = 0;
  const workerSteeringEnabled = containerInput.workerSteeringEnabled === true;

  // Poll IPC for follow-up messages, _close sentinel, and steering during the query
  let ipcPolling = true;
  let closedDuringQuery = false;
  const pollIpcDuringQuery = () => {
    if (!ipcPolling) return;
    if (shouldClose()) {
      log('Close sentinel detected during query, ending stream');
      closedDuringQuery = true;
      stream.end();
      ipcPolling = false;
      return;
    }
    const messages = drainIpcInput();
    for (const text of messages) {
      log(`Piping IPC message into active query (${text.length} chars)`);
      stream.push(text);
    }
    // Check for steering message and inject as follow-up
    if (workerSteeringEnabled && runId) {
      const steerMsg = checkForSteering(runId);
      if (steerMsg) {
        log(`Injecting steering into active query (${steerMsg.length} chars)`);
        stream.push(steerMsg);
      }
    }
    setTimeout(pollIpcDuringQuery, IPC_POLL_MS);
  };
  setTimeout(pollIpcDuringQuery, IPC_POLL_MS);

  let newSessionId: string | undefined;
  let lastAssistantUuid: string | undefined;
  let messageCount = 0;
  let resultCount = 0;
  let fallbackRequested = false;

  // Load global CLAUDE.md as additional system context (shared across all groups)
  const globalClaudeMdPath = '/workspace/global/CLAUDE.md';
  let globalClaudeMd: string | undefined;
  if (!containerInput.isMain && fs.existsSync(globalClaudeMdPath)) {
    globalClaudeMd = fs.readFileSync(globalClaudeMdPath, 'utf-8');
  }

  // Discover additional directories mounted at /workspace/extra/*
  // These are passed to the SDK so their CLAUDE.md files are loaded automatically
  const extraDirs: string[] = [];
  const extraBase = '/workspace/extra';
  if (fs.existsSync(extraBase)) {
    for (const entry of fs.readdirSync(extraBase)) {
      const fullPath = path.join(extraBase, entry);
      if (fs.statSync(fullPath).isDirectory()) {
        extraDirs.push(fullPath);
      }
    }
  }
  if (extraDirs.length > 0) {
    log(`Additional directories: ${extraDirs.join(', ')}`);
  }
  if (model) {
    log(`Using model: ${model}`);
  }

  // Heartbeat: emit periodic stderr lines so the host can re-arm its
  // no_output_timeout during long silent SDK phases (extended thinking, tool use).
  // Must be shorter than CONTAINER_NO_OUTPUT_TIMEOUT on the host side.
  const HEARTBEAT_INTERVAL_MS = 60_000;
  const heartbeatInterval = setInterval(() => {
    log('heartbeat');
  }, HEARTBEAT_INTERVAL_MS);

  for await (const message of query({
    prompt: stream,
    options: {
      cwd: '/workspace/group',
      additionalDirectories: extraDirs.length > 0 ? extraDirs : undefined,
      resume: sessionId,
      resumeSessionAt: resumeAt,
      systemPrompt: globalClaudeMd
        ? { type: 'preset' as const, preset: 'claude_code' as const, append: globalClaudeMd }
        : undefined,
      allowedTools: [
        'Bash',
        'Read', 'Write', 'Edit', 'Glob', 'Grep',
        'WebSearch', 'WebFetch',
        'Task', 'TaskOutput', 'TaskStop',
        'TeamCreate', 'TeamDelete', 'SendMessage',
        'TodoWrite', 'ToolSearch', 'Skill',
        'NotebookEdit',
        'mcp__nanoclaw__*'
      ],
      env: sdkEnv,
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      settingSources: ['project', 'user'],
      mcpServers: {
        nanoclaw: {
          command: 'node',
          args: [mcpServerPath],
          env: {
            NANOCLAW_CHAT_JID: containerInput.chatJid,
            NANOCLAW_GROUP_FOLDER: containerInput.groupFolder,
            NANOCLAW_IS_MAIN: containerInput.isMain ? '1' : '0',
            NANOCLAW_OPS_EXTENDED: containerInput.opsExtended ? '1' : '0',
            NANOCLAW_SCHEDULER_ENABLED: containerInput.schedulerEnabled ? '1' : '0',
            NANOCLAW_WORKER_STEERING_ENABLED: containerInput.workerSteeringEnabled ? '1' : '0',
            NANOCLAW_DYNAMIC_GROUP_REG_ENABLED: containerInput.dynamicGroupRegistrationEnabled ? '1' : '0',
          },
        },
      },
      hooks: {
        PreCompact: [{ hooks: [createPreCompactHook(containerInput.assistantName)] }],
        PreToolUse: [{ matcher: 'Bash', hooks: [createSanitizeBashHook()] }],
      },
      ...(model ? { model } : {}),
    }
  })) {
    messageCount++;
    const msgType = message.type === 'system' ? `system/${(message as { subtype?: string }).subtype}` : message.type;
    log(`[msg #${messageCount}] type=${msgType}`);

    // Emit progress event for assistant messages (throttled to PROGRESS_THROTTLE_MS)
    if (workerSteeringEnabled && runId && message.type === 'assistant') {
      const now = Date.now();
      if (now - lastProgressAt >= PROGRESS_THROTTLE_MS) {
        lastProgressAt = now;
        const content = (message as { message?: { content?: Array<{ type: string; name?: string; text?: string }> } }).message?.content;
        const toolUse = Array.isArray(content) ? content.find((c) => c.type === 'tool_use') : undefined;
        const textPart = Array.isArray(content) ? content.find((c) => c.type === 'text') : undefined;
        const event: WorkerProgressEvent = {
          kind: 'worker_progress',
          run_id: runId,
          group_folder: containerInput.groupFolder,
          timestamp: new Date().toISOString(),
          phase: toolUse ? `using ${toolUse.name}` : 'thinking',
          summary: toolUse
            ? `Tool: ${toolUse.name}`
            : (textPart?.text?.slice(0, 100) || 'Working...'),
          tool_used: toolUse?.name,
          seq: progressSeq++,
        };
        writeProgressEvent(event);
      }
    }

    if (message.type === 'assistant' && 'uuid' in message) {
      lastAssistantUuid = (message as { uuid: string }).uuid;
    }

    if (message.type === 'system' && message.subtype === 'init') {
      newSessionId = message.session_id;
      log(`Session initialized: ${newSessionId}`);
    }

    if (message.type === 'system' && (message as { subtype?: string }).subtype === 'task_notification') {
      const tn = message as { task_id: string; status: string; summary: string };
      log(`Task notification: task=${tn.task_id} status=${tn.status} summary=${tn.summary}`);
    }

    if (message.type === 'result') {
      resultCount++;
      const textResult = 'result' in message ? (message as { result?: string }).result : null;
      log(`Result #${resultCount}: subtype=${message.subtype}${textResult ? ` text=${textResult.slice(0, 200)}` : ''}`);
      if (
        allowApiFallback
        && authMode === 'oauth'
        && textResult
        && isOAuthLimitMessage(textResult)
      ) {
        fallbackRequested = true;
        log('OAuth limit detected in result output, suppressing result and switching to API key fallback');
        continue;
      }
      writeOutput({
        status: 'success',
        result: textResult || null,
        newSessionId,
        sessionResumeStatus,
        sessionResumeError,
      });
    }
  }

  clearInterval(heartbeatInterval);
  ipcPolling = false;
  log(`Query done. Messages: ${messageCount}, results: ${resultCount}, lastAssistantUuid: ${lastAssistantUuid || 'none'}, closedDuringQuery: ${closedDuringQuery}`);
  return { newSessionId, lastAssistantUuid, closedDuringQuery, fallbackRequested };
}

async function main(): Promise<void> {
  let containerInput: ContainerInput;

  try {
    const stdinData = await readStdin();
    containerInput = JSON.parse(stdinData);
    // Delete the temp file the entrypoint wrote — it contains secrets
    try { fs.unlinkSync('/tmp/input.json'); } catch { /* may not exist */ }
    log(`Received input for group: ${containerInput.groupFolder}`);
  } catch (err) {
    writeOutput({
      status: 'error',
      result: null,
      error: `Failed to parse input: ${err instanceof Error ? err.message : String(err)}`
    });
    process.exit(1);
  }

  // Build SDK env: keep secrets SDK-only (not process.env), and support
  // lane routing between OAuth and API-key providers for control lanes.
  const secrets = containerInput.secrets || {};
  const laneSupportsSwitch = canUseApiFallback(containerInput.groupFolder);
  const preferApiLane = laneSupportsSwitch && isFallbackToggleEnabled(secrets);
  const authFallbackAvailable = laneSupportsSwitch
    && !preferApiLane
    && !!secrets.CLAUDE_CODE_OAUTH_TOKEN
    && !!secrets.ANTHROPIC_API_KEY;
  let authMode = selectInitialAuthMode(containerInput.groupFolder, secrets);
  let sdkEnv = buildSdkEnv(process.env, secrets, authMode, containerInput.groupFolder);
  let model = selectModelForQuery(secrets, authMode);
  log(`Auth mode: ${authMode}${authFallbackAvailable ? ' (API fallback enabled)' : ''}`);

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const mcpServerPath = path.join(__dirname, 'ipc-mcp-stdio.js');

  // Worker runs pass runId explicitly from host; only fall back to parsing prompt
  // for backward compatibility with older container-input payloads.
  let runId: string | undefined = containerInput.runId;
  if (!runId && containerInput.groupFolder.startsWith('jarvis-worker')) {
    try {
      const payload = JSON.parse(containerInput.prompt) as { run_id?: string };
      runId = payload.run_id;
    } catch { /* not a JSON dispatch payload */ }
  }
  if (runId) log(`Worker run_id: ${runId}`);

  let sessionId = containerInput.sessionId;
  fs.mkdirSync(IPC_INPUT_DIR, { recursive: true });

  // Clean up stale _close sentinel from previous container runs
  try { fs.unlinkSync(IPC_INPUT_CLOSE_SENTINEL); } catch { /* ignore */ }

  // Build initial prompt (drain any pending IPC messages too)
  let prompt = containerInput.prompt;
  if (containerInput.isScheduledTask) {
    prompt = `[SCHEDULED TASK - The following message was sent automatically and is not coming directly from the user or group.]\n\n${prompt}`;
  }
  const pending = drainIpcInput();
  if (pending.length > 0) {
    log(`Draining ${pending.length} pending IPC messages into initial prompt`);
    prompt += '\n' + pending.join('\n');
  }

  // Query loop: run query → wait for IPC message → run new query → repeat
  let resumeAt: string | undefined;
  let sessionResumeStatus: ContainerOutput['sessionResumeStatus'] = sessionId ? 'resumed' : 'new';
  let sessionResumeError: string | undefined;
  let resumeFallbackAttempted = false;
  try {
    while (true) {
      log(`Starting query (session: ${sessionId || 'new'}, resumeAt: ${resumeAt || 'latest'})...`);

      let queryResult;
      try {
        queryResult = await runQuery(
          prompt,
          sessionId,
          mcpServerPath,
          containerInput,
          sdkEnv,
          authMode,
          model,
          authFallbackAvailable,
          sessionResumeStatus,
          sessionResumeError,
          resumeAt,
          runId,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (sessionId && !resumeFallbackAttempted && isSessionResumeErrorMessage(message)) {
          log(`Session resume failed, falling back to new session: ${message}`);
          resumeFallbackAttempted = true;
          sessionResumeStatus = 'fallback_new';
          sessionResumeError = message.slice(0, 500);
          sessionId = undefined;
          resumeAt = undefined;
          continue;
        }
        if (authFallbackAvailable && authMode === 'oauth' && isOAuthLimitMessage(message)) {
          log('OAuth query error indicates limit reached, switching to API key fallback');
          authMode = 'apiKey';
          sdkEnv = buildSdkEnv(process.env, secrets, authMode, containerInput.groupFolder);
          model = selectModelForQuery(secrets, authMode);
          sessionId = undefined;
          resumeAt = undefined;
          continue;
        }
        throw err;
      }

      if (queryResult.fallbackRequested && authFallbackAvailable && authMode === 'oauth') {
        authMode = 'apiKey';
        sdkEnv = buildSdkEnv(process.env, secrets, authMode, containerInput.groupFolder);
        model = selectModelForQuery(secrets, authMode);
        sessionId = undefined;
        resumeAt = undefined;
        log('Retrying prompt with API key fallback after OAuth limit signal');
        continue;
      }

      if (queryResult.newSessionId) {
        sessionId = queryResult.newSessionId;
      }
      if (queryResult.lastAssistantUuid) {
        resumeAt = queryResult.lastAssistantUuid;
      }

      // If _close was consumed during the query, exit immediately.
      // Don't emit a session-update marker (it would reset the host's
      // idle timer and cause a 30-min delay before the next _close).
      if (queryResult.closedDuringQuery) {
        log('Close sentinel consumed during query, exiting');
        break;
      }

      // Emit session update so host can track it
      writeOutput({
        status: 'success',
        result: null,
        newSessionId: sessionId,
        sessionResumeStatus,
        sessionResumeError,
      });

      log('Query ended, waiting for next IPC message...');

      // Drain any pending steer event between turns
      if (runId) {
        const steerBetweenTurns = checkForSteering(runId);
        if (steerBetweenTurns) {
          log(`Steer message received between turns, starting new query`);
          prompt = steerBetweenTurns;
          continue;
        }
      }

      // Wait for the next message or _close sentinel
      const nextMessage = await waitForIpcMessage();
      if (nextMessage === null) {
        log('Close sentinel received, exiting');
        break;
      }

      log(`Got new message (${nextMessage.length} chars), starting new query`);
      prompt = nextMessage;
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    log(`Agent error: ${errorMessage}`);
    writeOutput({
      status: 'error',
      result: null,
      newSessionId: sessionId,
      sessionResumeStatus,
      sessionResumeError,
      error: errorMessage
    });
    process.exit(1);
  }
}

main();
