import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  normalizeCommitShaFromWorkspace,
  resetGitWorkspaceState,
  verifyGitWorkspaceState,
} from './worker-workspace-verifier.js';

function run(cmd: string[], cwd: string): string {
  return execFileSync(cmd[0], cmd.slice(1), {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function createRepo(): { dir: string; head: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nanoclaw-worker-verify-'));
  run(['git', 'init', '-b', 'jarvis-test-branch'], dir);
  run(['git', 'config', 'user.email', 'test@example.com'], dir);
  run(['git', 'config', 'user.name', 'Test User'], dir);
  fs.writeFileSync(path.join(dir, 'README.md'), '# test\n');
  run(['git', 'add', 'README.md'], dir);
  run(['git', 'commit', '-m', 'init'], dir);
  return { dir, head: run(['git', 'rev-parse', 'HEAD'], dir) };
}

const cleanupDirs: string[] = [];

afterEach(() => {
  while (cleanupDirs.length > 0) {
    fs.rmSync(cleanupDirs.pop()!, { recursive: true, force: true });
  }
});

describe('verifyGitWorkspaceState', () => {
  it('passes when branch, head, and worktree all match', () => {
    const repo = createRepo();
    cleanupDirs.push(repo.dir);

    const result = verifyGitWorkspaceState({
      repoPath: repo.dir,
      expectedBranch: 'jarvis-test-branch',
      expectedCommitSha: repo.head,
      requireCleanWorktree: true,
    });

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('fails when the active branch does not match', () => {
    const repo = createRepo();
    cleanupDirs.push(repo.dir);

    const result = verifyGitWorkspaceState({
      repoPath: repo.dir,
      expectedBranch: 'jarvis-other-branch',
      expectedCommitSha: repo.head,
      requireCleanWorktree: true,
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('workspace branch mismatch');
  });

  it('fails when the worktree is dirty', () => {
    const repo = createRepo();
    cleanupDirs.push(repo.dir);
    fs.writeFileSync(path.join(repo.dir, 'README.md'), '# changed\n');

    const result = verifyGitWorkspaceState({
      repoPath: repo.dir,
      expectedBranch: 'jarvis-test-branch',
      expectedCommitSha: repo.head,
      requireCleanWorktree: true,
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('workspace dirty');
  });

  it('resets a dirty repo back to a clean base branch', () => {
    const repo = createRepo();
    cleanupDirs.push(repo.dir);
    run(['git', 'checkout', '-b', 'jarvis-dirty-branch'], repo.dir);
    fs.writeFileSync(path.join(repo.dir, 'README.md'), '# changed\n');
    fs.writeFileSync(path.join(repo.dir, 'TEMP.txt'), 'temp\n');

    const reset = resetGitWorkspaceState({
      repoPath: repo.dir,
      baseBranch: 'jarvis-test-branch',
    });

    expect(reset.existed).toBe(true);
    expect(reset.checkedOutBaseBranch).toBe(true);
    expect(reset.removedCorruptRepo).toBe(false);
    expect(run(['git', 'branch', '--show-current'], repo.dir)).toBe(
      'jarvis-test-branch',
    );
    expect(run(['git', 'status', '--short'], repo.dir)).toBe('');
    expect(fs.existsSync(path.join(repo.dir, 'TEMP.txt'))).toBe(false);
  });

  it('removes a corrupt repo instead of retrying reset against bad HEAD state', () => {
    const repo = createRepo();
    cleanupDirs.push(repo.dir);
    fs.writeFileSync(
      path.join(repo.dir, '.git', 'refs', 'heads', 'jarvis-test-branch'),
      'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef\n',
    );

    const reset = resetGitWorkspaceState({
      repoPath: repo.dir,
      baseBranch: 'jarvis-test-branch',
    });

    expect(reset.existed).toBe(false);
    expect(reset.checkedOutBaseBranch).toBe(false);
    expect(reset.removedCorruptRepo).toBe(true);
    expect(fs.existsSync(repo.dir)).toBe(false);
    cleanupDirs.pop();
  });

  it('normalizes a mismatched reported commit to the verified workspace head', () => {
    const repo = createRepo();
    cleanupDirs.push(repo.dir);

    const verification = verifyGitWorkspaceState({
      repoPath: repo.dir,
      expectedBranch: 'jarvis-test-branch',
      expectedCommitSha: repo.head,
      requireCleanWorktree: true,
    });

    const normalized = normalizeCommitShaFromWorkspace({
      reportedCommitSha: 'deadbeef',
      expectedBranch: 'jarvis-test-branch',
      verification,
    });

    expect(normalized).toBe(repo.head);
  });
});
