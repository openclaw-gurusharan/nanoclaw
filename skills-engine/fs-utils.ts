import fs from 'fs';
import path from 'path';

export function copyPathPreservingLinks(src: string, dest: string): void {
  const stat = fs.lstatSync(src);

  if (stat.isSymbolicLink()) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const target = fs.readlinkSync(src);
    try {
      fs.unlinkSync(dest);
    } catch {}
    fs.symlinkSync(target, dest);
    return;
  }

  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    copyDir(src, dest);
    return;
  }

  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

/**
 * Recursively copy a directory tree from src to dest.
 * Creates destination directories as needed.
 */
export function copyDir(src: string, dest: string): void {
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      fs.mkdirSync(destPath, { recursive: true });
      copyDir(srcPath, destPath);
    } else {
      copyPathPreservingLinks(srcPath, destPath);
    }
  }
}
