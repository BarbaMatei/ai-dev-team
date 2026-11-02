import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

export function git(cwd, args) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith('GIT_') && k !== 'GIT_CEILING_DIRECTORIES') delete env[k];
  return spawnSync('git', args, { cwd, env, encoding: 'utf8' });
}

export function isRepoRoot(cwd) {
  const r = git(cwd, ['rev-parse', '--show-toplevel']);
  if (r.status !== 0) return false;
  try {
    return fs.realpathSync.native(r.stdout.trim()) === fs.realpathSync.native(cwd);
  } catch {
    return false;
  }
}
