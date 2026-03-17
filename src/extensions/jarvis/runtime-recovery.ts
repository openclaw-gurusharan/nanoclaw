import {
  getUnprocessedMessages,
  getRecentBotMessages,
  getMessagesSince,
  getWorkerRun,
  getWorkerRuns,
  markMessagesProcessed,
  requeueWorkerRunForReplay,
  storeChatMetadata,
  storeMessage,
} from '../../db.js';
import { hasRunningContainerWithPrefix } from '../../container-runtime.js';
import { parseDispatchPayload } from '../../dispatch-validator.js';
import { logger } from '../../logger.js';
import type { RegisteredGroup } from '../../types.js';
import type { WorkerRunSupervisor } from '../../worker-run-supervisor.js';
import {
  applyAndyReviewStateUpdates,
  parseAndyReviewStateUpdates,
  resolveAndyRequestForMessage,
} from './request-state-service.js';

interface MessageRecoveryQueue {
  enqueueMessageCheck(chatJid: string): void;
}

function isTerminalAndyRequestState(state: string | undefined): boolean {
  return state === 'completed' || state === 'failed' || state === 'cancelled';
}

export function findChatJidByGroupFolder(
  registeredGroups: Record<string, RegisteredGroup>,
  groupFolder: string,
): string | undefined {
  return Object.entries(registeredGroups).find(
    ([, group]) => group.folder === groupFolder,
  )?.[0];
}

export function reconcileJarvisStaleWorkerRuns(input: {
  workerRunSupervisor: WorkerRunSupervisor;
  lastAgentTimestamp: Record<string, string>;
  registeredGroups: Record<string, RegisteredGroup>;
}): boolean {
  return input.workerRunSupervisor.reconcile({
    lastAgentTimestamp: input.lastAgentTimestamp,
    resolveChatJid: (groupFolder) =>
      findChatJidByGroupFolder(input.registeredGroups, groupFolder),
  });
}

export function recoverPendingMessages(input: {
  registeredGroups: Record<string, RegisteredGroup>;
  lastAgentTimestamp: Record<string, string>;
  assistantName: string;
  queue: MessageRecoveryQueue;
}): void {
  for (const [chatJid, group] of Object.entries(input.registeredGroups)) {
    const sinceTimestamp = input.lastAgentTimestamp[chatJid] || '';
    const pending = getMessagesSince(
      chatJid,
      sinceTimestamp,
      input.assistantName,
    );
    if (pending.length === 0) continue;

    const staleTerminalIds: string[] = [];
    const replayable = pending.filter((message) => {
      if (group.folder !== 'andy-developer') return true;
      const request = resolveAndyRequestForMessage(message);
      if (!isTerminalAndyRequestState(request?.state)) return true;
      staleTerminalIds.push(message.id);
      return false;
    });

    if (staleTerminalIds.length > 0) {
      markMessagesProcessed(chatJid, staleTerminalIds);
      logger.info(
        {
          group: group.name,
          staleCount: staleTerminalIds.length,
        },
        'Recovery: marked stale terminal Andy messages processed',
      );
    }

    if (replayable.length === 0) continue;
    logger.info(
      { group: group.name, pendingCount: replayable.length },
      'Recovery: found unprocessed messages',
    );
    input.queue.enqueueMessageCheck(chatJid);
  }
}

export function recoverTerminalWorkerDispatchMessages(input: {
  registeredGroups: Record<string, RegisteredGroup>;
}): void {
  const terminalStatuses = new Set([
    'review_requested',
    'done',
    'failed',
    'failed_contract',
    'failed_timeout',
  ]);

  for (const [chatJid, group] of Object.entries(input.registeredGroups)) {
    if (!group.folder.startsWith('jarvis-worker-')) continue;

    const staleIds = getUnprocessedMessages(chatJid)
      .filter((message) => {
        const payload = parseDispatchPayload(message.content);
        if (!payload) return false;
        const run = getWorkerRun(payload.run_id);
        return !!run && terminalStatuses.has(run.status);
      })
      .map((message) => message.id);

    if (staleIds.length === 0) continue;
    markMessagesProcessed(chatJid, staleIds);
    logger.info(
      { group: group.name, staleCount: staleIds.length },
      'Recovery: marked stranded terminal worker dispatch messages as processed',
    );
  }
}

export function recoverAndyReviewStateFromStoredMessages(input: {
  registeredGroups: Record<string, RegisteredGroup>;
}): void {
  let recoveredUpdates = 0;
  let recoveredChats = 0;

  for (const [chatJid, group] of Object.entries(input.registeredGroups)) {
    if (group.folder !== 'andy-developer') continue;

    const storedBotMessages = getRecentBotMessages(chatJid, 100);
    let chatRecovered = false;
    for (const message of storedBotMessages) {
      const updates = parseAndyReviewStateUpdates(message.content);
      if (updates.length === 0) continue;
      applyAndyReviewStateUpdates(updates);
      recoveredUpdates += updates.length;
      chatRecovered = true;
    }

    if (chatRecovered) {
      recoveredChats += 1;
    }
  }

  if (recoveredUpdates > 0) {
    logger.info(
      { recoveredUpdates, recoveredChats },
      'Recovery: reconciled Andy review state from stored bot messages',
    );
  }
}

export function recoverInterruptedWorkerDispatches(input: {
  registeredGroups: Record<string, RegisteredGroup>;
  queue: MessageRecoveryQueue;
}): void {
  const activeRuns = getWorkerRuns({
    groupFolderLike: 'jarvis-worker-%',
    statuses: ['queued', 'running'],
    limit: 200,
  });

  if (activeRuns.length === 0) return;

  let replayed = 0;
  let skipped = 0;
  for (const run of activeRuns) {
    const chatJid = findChatJidByGroupFolder(
      input.registeredGroups,
      run.group_folder,
    );
    if (!chatJid) {
      skipped += 1;
      logger.warn(
        { runId: run.run_id, groupFolder: run.group_folder },
        'Startup replay skipped: worker chat JID not registered',
      );
      continue;
    }

    const payloadText = run.dispatch_payload || '';
    const parsed = parseDispatchPayload(payloadText);
    if (!parsed) {
      skipped += 1;
      logger.warn(
        { runId: run.run_id, groupFolder: run.group_folder },
        'Startup replay skipped: missing or invalid dispatch payload',
      );
      continue;
    }

    const hasPendingDispatchForRun = getUnprocessedMessages(chatJid).some(
      (message) => parseDispatchPayload(message.content)?.run_id === run.run_id,
    );
    const hasRunningContainer = hasRunningContainerWithPrefix(
      `nanoclaw-${run.group_folder}-`,
    );
    if (
      hasPendingDispatchForRun &&
      run.status === 'running' &&
      !hasRunningContainer
    ) {
      requeueWorkerRunForReplay(
        run.run_id,
        'running_without_container_startup_replay',
      );
      logger.warn(
        { runId: run.run_id, groupFolder: run.group_folder },
        'Recovered startup replay candidate that was marked running without an active container',
      );
    }
    if (hasPendingDispatchForRun) {
      skipped += 1;
      logger.info(
        { runId: run.run_id, groupFolder: run.group_folder },
        'Startup replay skipped: unprocessed dispatch already exists for run_id',
      );
      continue;
    }

    if (run.status === 'running') {
      requeueWorkerRunForReplay(run.run_id, 'startup_replay_after_restart');
    }

    const replayTimestamp = new Date().toISOString();
    storeChatMetadata(
      chatJid,
      replayTimestamp,
      input.registeredGroups[chatJid]?.name || run.group_folder,
      'nanoclaw',
      true,
    );
    storeMessage({
      id: `replay-${run.run_id}-${Date.now()}`,
      chat_jid: chatJid,
      sender: 'nanoclaw-replay@nanoclaw',
      sender_name: 'nanoclaw-replay',
      content: JSON.stringify(parsed),
      timestamp: replayTimestamp,
      is_from_me: false,
      is_bot_message: false,
    });
    input.queue.enqueueMessageCheck(chatJid);
    replayed += 1;
  }

  logger.info(
    { activeRuns: activeRuns.length, replayed, skipped },
    'Startup worker dispatch replay complete',
  );
}
