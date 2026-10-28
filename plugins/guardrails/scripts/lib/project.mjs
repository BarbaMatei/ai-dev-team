import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export function toPosix(p) {
  return p.replace(/\\/g, '/');
}

export function projectRoot(cwd) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith('GIT_')) delete env[k];
  const r = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd, env, encoding: 'utf8' });
  const top = r.status === 0 ? r.stdout.trim() : '';
  return top ? path.resolve(top) : cwd;
}

export function loadConfig(root) {
  const file = path.join(root, '.claude', 'ai-dev-team.json');
  if (!fs.existsSync(file)) return {};
  try {
    const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (cfg === null || typeof cfg !== 'object' || Array.isArray(cfg)) throw new Error('expected a JSON object');
    return cfg;
  } catch (e) {
    throw new Error(`.claude/ai-dev-team.json: ${e.message}`);
  }
}

export function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        i++;
        if (glob[i + 1] === '/') {
          i++;
          re += '(?:.*/)?';
        } else re += '.*';
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

export function matchesAny(relPath, globs) {
  const p = toPosix(relPath);
  return globs.some((g) => globToRegExp(g).test(p));
}
