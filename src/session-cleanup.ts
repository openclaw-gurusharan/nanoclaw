import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';

import { logger } from './logger.js';

const CLEANUP_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours
const SCRIPT_PATH = path.resolve(process.cwd(), 'scripts/cleanup-sessions.sh');
let missingScriptLogged = false;

function hasCleanupScript(): boolean {
  if (fs.existsSync(SCRIPT_PATH)) return true;
  if (!missingScriptLogged) {
    missingScriptLogged = true;
    logger.debug(
      { scriptPath: SCRIPT_PATH },
      'Session cleanup hook not installed, skipping',
    );
  }
  return false;
}

function runCleanup(): void {
  if (!hasCleanupScript()) return;
  execFile('/bin/bash', [SCRIPT_PATH], { timeout: 60_000 }, (err, stdout) => {
    if (err) {
      logger.error({ err }, 'Session cleanup failed');
      return;
    }
    const summary = stdout.trim().split('\n').pop();
    if (summary) logger.info(summary);
  });
}

export function startSessionCleanup(): void {
  if (!hasCleanupScript()) return;
  // Run once at startup (delayed 30s to not compete with init)
  setTimeout(runCleanup, 30_000);
  // Then every 24 hours
  setInterval(runCleanup, CLEANUP_INTERVAL);
}
