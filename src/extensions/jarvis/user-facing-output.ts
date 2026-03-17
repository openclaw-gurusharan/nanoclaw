import { IPC_POLL_INTERVAL } from '../../config.js';
import { getAndyRequestById, getWorkerRun } from '../../db.js';
import { parseDispatchPayload } from '../../dispatch-validator.js';
import { type RegisteredGroup } from '../../types.js';

const ANDY_DEVELOPER_FOLDER = 'andy-developer';
const DISPATCH_CONFIRMATION_TIMEOUT_MS = IPC_POLL_INTERVAL + 250;
const DISPATCH_CONFIRMATION_POLL_MS = 50;
const DISPATCH_INTENT_PROSE_PATTERN =
  /\b(?:dispatch(?:ed|ing)?|queued|queueing)\b[\s\S]*\b(?:jarvis-worker-[12]|worker)\b/i;

interface UserFacingOutputDeps {
  getRequestById?: typeof getAndyRequestById;
  getWorkerRunById?: typeof getWorkerRun;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  pollIntervalMs?: number;
}

function stripCodeFence(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : trimmed;
}

function buildPendingDispatchMessage(
  requestId: string | undefined,
  runId: string,
): string {
  if (requestId) {
    return `Still coordinating \`${requestId}\`. Worker dispatch for \`${runId}\` is not confirmed yet.`;
  }
  return `Still coordinating worker dispatch \`${runId}\`. Queue confirmation is still pending.`;
}

function buildPendingDispatchProseMessage(): string {
  return 'Still coordinating worker dispatch. Acceptance is still being validated.';
}

async function waitForDispatchConfirmation(
  runId: string,
  requestId: string | undefined,
  deps: Required<UserFacingOutputDeps>,
): Promise<boolean> {
  const deadline = Date.now() + deps.timeoutMs;

  while (true) {
    const run = deps.getWorkerRunById(runId);
    const request = requestId ? deps.getRequestById(requestId) : undefined;
    const requestLinked = requestId ? request?.worker_run_id === runId : true;

    if (run && requestLinked) return true;
    if (Date.now() >= deadline) return false;

    await deps.sleep(deps.pollIntervalMs);
  }
}

export async function sanitizeUserFacingOutput(
  group: RegisteredGroup,
  text: string,
  deps: UserFacingOutputDeps = {},
): Promise<string> {
  if (group.folder !== ANDY_DEVELOPER_FOLDER) return text;

  const parsed = parseDispatchPayload(stripCodeFence(text));
  if (!parsed) {
    if (DISPATCH_INTENT_PROSE_PATTERN.test(text)) {
      return buildPendingDispatchProseMessage();
    }
    return text;
  }

  const resolvedDeps: Required<UserFacingOutputDeps> = {
    getRequestById: deps.getRequestById ?? getAndyRequestById,
    getWorkerRunById: deps.getWorkerRunById ?? getWorkerRun,
    sleep:
      deps.sleep ??
      ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms))),
    timeoutMs: deps.timeoutMs ?? DISPATCH_CONFIRMATION_TIMEOUT_MS,
    pollIntervalMs: deps.pollIntervalMs ?? DISPATCH_CONFIRMATION_POLL_MS,
  };

  const confirmed = await waitForDispatchConfirmation(
    parsed.run_id,
    parsed.request_id,
    resolvedDeps,
  );
  if (!confirmed) {
    return buildPendingDispatchMessage(parsed.request_id, parsed.run_id);
  }

  const requestLabel = parsed.request_id ? ` for \`${parsed.request_id}\`` : '';
  return `Dispatched \`${parsed.run_id}\`${requestLabel} to \`${parsed.repo}\` on \`${parsed.branch}\` (${parsed.task_type}).`;
}
