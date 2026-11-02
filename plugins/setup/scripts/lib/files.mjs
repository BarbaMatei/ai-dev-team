import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const lf = (text) => text.replace(/\r\n/g, '\n');

export function createFile(root, rel, content) {
  const target = path.join(root, ...rel.split('/'));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, { mode: rel === '.githooks/pre-commit' ? 0o755 : 0o644 });
  if (rel === '.githooks/pre-commit') fs.chmodSync(target, 0o755);
}

export function hookLine(root, created) {
  if (!created.includes('.githooks/pre-commit')) return null;
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith('GIT_')) delete env[k];
  const r = spawnSync('git', ['config', 'core.hooksPath', '.githooks'], { cwd: root, env, encoding: 'utf8' });
  if (r.status === 0) return 'hooksPath .githooks';
  const why = (r.stderr || r.error?.message || 'git failed').split('\n')[0];
  return `hooksPath not set: ${why}`;
}
