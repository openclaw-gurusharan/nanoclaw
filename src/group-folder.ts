import fs from 'fs';
import path from 'path';

import { DATA_DIR, GROUPS_DIR } from './config.js';

const GROUP_FOLDER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const RESERVED_FOLDERS = new Set(['global']);

export function isValidGroupFolder(folder: string): boolean {
  if (!folder) return false;
  if (folder !== folder.trim()) return false;
  if (!GROUP_FOLDER_PATTERN.test(folder)) return false;
  if (folder.includes('/') || folder.includes('\\')) return false;
  if (folder.includes('..')) return false;
  if (RESERVED_FOLDERS.has(folder.toLowerCase())) return false;
  return true;
}

export function assertValidGroupFolder(folder: string): void {
  if (!isValidGroupFolder(folder)) {
    throw new Error(`Invalid group folder "${folder}"`);
  }
}

function ensureWithinBase(baseDir: string, resolvedPath: string): void {
  const rel = path.relative(baseDir, resolvedPath);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`Path escapes base directory: ${resolvedPath}`);
  }
}

export function resolveGroupFolderPath(folder: string): string {
  assertValidGroupFolder(folder);
  const groupPath = path.resolve(GROUPS_DIR, folder);
  ensureWithinBase(GROUPS_DIR, groupPath);
  return groupPath;
}

export function resolveGroupIpcPath(folder: string): string {
  assertValidGroupFolder(folder);
  const ipcBaseDir = path.resolve(DATA_DIR, 'ipc');
  const ipcPath = path.resolve(ipcBaseDir, folder);
  ensureWithinBase(ipcBaseDir, ipcPath);
  return ipcPath;
}

/**
 * Validate that a group's CLAUDE.md is present and non-empty.
 * Throws an InstructionsLoaded error for missing, unreadable, or empty files.
 * Pass baseDir to override GROUPS_DIR (useful in tests).
 */
export function validateGroupClaudeMd(folder: string, baseDir?: string): void {
  const groupPath = baseDir
    ? path.resolve(baseDir, folder)
    : resolveGroupFolderPath(folder);
  const claudeMdPath = path.join(groupPath, 'CLAUDE.md');

  let content: string;
  try {
    content = fs.readFileSync(claudeMdPath, 'utf8');
  } catch {
    throw new Error(
      `InstructionsLoaded: ${claudeMdPath} is missing or unreadable`,
    );
  }

  if (!content.trim()) {
    throw new Error(`InstructionsLoaded: ${claudeMdPath} is empty`);
  }
}
