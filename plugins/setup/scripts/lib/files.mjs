import fs from 'node:fs';
import path from 'node:path';
import { git, isRepoRoot } from './repo.mjs';

export const lf = (text) => text.replace(/\r\n/g, '\n');

export function createFile(root, rel, content) {
  const target = path.join(root, ...rel.split('/'));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, { mode: rel === '.githooks/pre-commit' ? 0o755 : 0o644 });
  if (rel === '.githooks/pre-commit') fs.chmodSync(target, 0o755);
}

export function hookLine(root, created) {
  if (!created.includes('.githooks/pre-commit')) return null;
  if (!isRepoRoot(root)) return `hooksPath not set: ${root} is not a git repository root`;
  const have = git(root, ['config', '--get', 'core.hooksPath']).stdout.trim();
  if (have && have !== '.githooks') return `hooksPath kept ${have}`;
  const r = git(root, ['config', 'core.hooksPath', '.githooks']);
  if (r.status === 0) return 'hooksPath .githooks';
  const why = (r.stderr || r.error?.message || 'git failed').split('\n')[0];
  return `hooksPath not set: ${why}`;
}
