import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

import { resolveGroupFolderPath } from './group-folder.js';

export type GitWorkspaceVerification = {
  valid: boolean;
  errors: string[];
  repoPath: string;
  actualBranch: string | null;
  headCommit: string | null;
  dirtyEntries: string[];
};

export function normalizeCommitShaFromWorkspace(input: {
  reportedCommitSha: string;
  expectedBranch: string;
  verification: GitWorkspaceVerification;
}): string | null {
  const { reportedCommitSha, expectedBranch, verification } = input;
  if (!verification.headCommit) return null;
  if (verification.actualBranch !== expectedBranch) return null;
  if (verification.dirtyEntries.length > 0) return null;
  if (verification.headCommit === reportedCommitSha)
    return verification.headCommit;
  return verification.headCommit;
}

export function getWorkerRepoWorkspacePath(
  groupFolder: string,
  repoSlug: string,
): string {
  const repoName = repoSlug.split('/').pop()?.trim();
  if (!repoName) {
    throw new Error(`Invalid repo slug: ${repoSlug}`);
  }
  return path.join(resolveGroupFolderPath(groupFolder), 'workspace', repoName);
}

function runGit(repoPath: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd: repoPath,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

export function getGitHeadFiles(repoPath: string): string[] {
  if (!fs.existsSync(repoPath)) return [];
  try {
    return runGit(repoPath, ['show', '--pretty=', '--name-only', 'HEAD'])
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

export function verifyGitWorkspaceState(options: {
  repoPath: string;
  expectedBranch: string;
  expectedCommitSha: string;
  requireCleanWorktree?: boolean;
}): GitWorkspaceVerification {
  const { repoPath, expectedBranch, expectedCommitSha, requireCleanWorktree } =
    options;
  const errors: string[] = [];

  if (!fs.existsSync(repoPath)) {
    return {
      valid: false,
      errors: ['workspace repo missing'],
      repoPath,
      actualBranch: null,
      headCommit: null,
      dirtyEntries: [],
    };
  }

  try {
    const actualBranch = runGit(repoPath, ['branch', '--show-current']);
    const headCommit = runGit(repoPath, ['rev-parse', 'HEAD']);
    const dirtyEntries = runGit(repoPath, ['status', '--porcelain'])
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    if (actualBranch !== expectedBranch) {
      errors.push('workspace branch mismatch');
    }
    if (headCommit !== expectedCommitSha) {
      errors.push('workspace head mismatch');
    }
    if (requireCleanWorktree && dirtyEntries.length > 0) {
      errors.push('workspace dirty');
    }

    return {
      valid: errors.length === 0,
      errors,
      repoPath,
      actualBranch,
      headCommit,
      dirtyEntries,
    };
  } catch {
    return {
      valid: false,
      errors: ['workspace git inspect failed'],
      repoPath,
      actualBranch: null,
      headCommit: null,
      dirtyEntries: [],
    };
  }
}

export function resetGitWorkspaceState(options: {
  repoPath: string;
  baseBranch?: string;
}): {
  repoPath: string;
  existed: boolean;
  checkedOutBaseBranch: boolean;
  removedCorruptRepo: boolean;
} {
  const { repoPath, baseBranch } = options;
  if (!fs.existsSync(repoPath)) {
    return {
      repoPath,
      existed: false,
      checkedOutBaseBranch: false,
      removedCorruptRepo: false,
    };
  }

  try {
    runGit(repoPath, ['reset', '--hard']);
    runGit(repoPath, ['clean', '-fd']);
  } catch {
    fs.rmSync(repoPath, { recursive: true, force: true });
    return {
      repoPath,
      existed: false,
      checkedOutBaseBranch: false,
      removedCorruptRepo: true,
    };
  }

  let checkedOutBaseBranch = false;
  if (baseBranch) {
    try {
      runGit(repoPath, ['checkout', '-f', baseBranch]);
      checkedOutBaseBranch = true;
    } catch {
      checkedOutBaseBranch = false;
    }
  }

  return {
    repoPath,
    existed: true,
    checkedOutBaseBranch,
    removedCorruptRepo: false,
  };
}
