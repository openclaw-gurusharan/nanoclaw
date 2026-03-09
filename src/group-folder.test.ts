import fs from 'fs';
import os from 'os';
import path from 'path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  isValidGroupFolder,
  resolveGroupFolderPath,
  resolveGroupIpcPath,
  validateGroupClaudeMd,
} from './group-folder.js';

describe('group folder validation', () => {
  it('accepts normal group folder names', () => {
    expect(isValidGroupFolder('main')).toBe(true);
    expect(isValidGroupFolder('family-chat')).toBe(true);
    expect(isValidGroupFolder('Team_42')).toBe(true);
  });

  it('rejects traversal and reserved names', () => {
    expect(isValidGroupFolder('../../etc')).toBe(false);
    expect(isValidGroupFolder('/tmp')).toBe(false);
    expect(isValidGroupFolder('global')).toBe(false);
    expect(isValidGroupFolder('')).toBe(false);
  });

  it('resolves safe paths under groups directory', () => {
    const resolved = resolveGroupFolderPath('family-chat');
    expect(resolved.endsWith(`${path.sep}groups${path.sep}family-chat`)).toBe(
      true,
    );
  });

  it('resolves safe paths under data ipc directory', () => {
    const resolved = resolveGroupIpcPath('family-chat');
    expect(
      resolved.endsWith(`${path.sep}data${path.sep}ipc${path.sep}family-chat`),
    ).toBe(true);
  });

  it('throws for unsafe folder names', () => {
    expect(() => resolveGroupFolderPath('../../etc')).toThrow();
    expect(() => resolveGroupIpcPath('/tmp')).toThrow();
  });
});

describe('validateGroupClaudeMd', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nanoclaw-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('passes for a group with a valid non-empty CLAUDE.md', () => {
    const groupDir = path.join(tmpDir, 'my-group');
    fs.mkdirSync(groupDir);
    fs.writeFileSync(
      path.join(groupDir, 'CLAUDE.md'),
      '# My Group\nInstructions here.\n',
    );
    expect(() => validateGroupClaudeMd('my-group', tmpDir)).not.toThrow();
  });

  it('throws InstructionsLoaded when CLAUDE.md is missing', () => {
    const groupDir = path.join(tmpDir, 'no-claude');
    fs.mkdirSync(groupDir);
    expect(() => validateGroupClaudeMd('no-claude', tmpDir)).toThrow(
      /InstructionsLoaded/,
    );
    expect(() => validateGroupClaudeMd('no-claude', tmpDir)).toThrow(
      /missing or unreadable/,
    );
  });

  it('throws InstructionsLoaded when CLAUDE.md is empty', () => {
    const groupDir = path.join(tmpDir, 'empty-group');
    fs.mkdirSync(groupDir);
    fs.writeFileSync(path.join(groupDir, 'CLAUDE.md'), '   \n\n  ');
    expect(() => validateGroupClaudeMd('empty-group', tmpDir)).toThrow(
      /InstructionsLoaded/,
    );
    expect(() => validateGroupClaudeMd('empty-group', tmpDir)).toThrow(/empty/);
  });

  it('throws InstructionsLoaded when the group directory does not exist', () => {
    expect(() => validateGroupClaudeMd('ghost-group', tmpDir)).toThrow(
      /InstructionsLoaded/,
    );
  });
});
