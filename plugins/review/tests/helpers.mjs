import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const base = fs.mkdtempSync(path.join(os.tmpdir(), 'rv-'));
let n = 0;

export function cleanEnv() {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith('GIT_')) delete env[k];
  return env;
}

export function git(cwd, args) {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { cwd, env: cleanEnv(), encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
}

export function put(dir, rel, content) {
  const f = path.join(dir, ...rel.split('/'));
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, content);
}

export function repo(files = {}, config) {
  const dir = path.join(base, `r${n++}`);
  fs.mkdirSync(dir);
  git(dir, ['init', '-q', '-b', 'main']);
  if (config !== undefined) put(dir, '.claude/ai-dev-team.json', typeof config === 'string' ? config : JSON.stringify(config));
  for (const [rel, c] of Object.entries(files)) put(dir, rel, c);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'init', '--allow-empty']);
  return dir;
}

export function run(script, dir, args) {
  const r = spawnSync(process.execPath, [script, ...args], { cwd: dir, env: cleanEnv(), encoding: 'utf8' });
  return { code: r.status, out: r.stdout, err: r.stderr };
}
