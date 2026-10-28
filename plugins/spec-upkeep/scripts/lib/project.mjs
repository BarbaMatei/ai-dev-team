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

function globSource(glob) {
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
    else if (c === '{' && closingBrace(glob, i) > 0) {
      const end = closingBrace(glob, i);
      re += `(?:${splitTop(glob.slice(i + 1, end)).map(globSource).join('|')})`;
      i = end;
    } else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return re;
}

function closingBrace(glob, open) {
  let depth = 0;
  for (let i = open; i < glob.length; i++) {
    if (glob[i] === '{') depth++;
    else if (glob[i] === '}' && --depth === 0) return i;
  }
  return -1;
}

export function splitTop(body) {
  const parts = [];
  let depth = 0;
  let cur = '';
  for (const c of body) {
    if (c === ',' && depth === 0) {
      parts.push(cur);
      cur = '';
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') depth--;
    cur += c;
  }
  return [...parts, cur];
}

export function globToRegExp(glob) {
  return new RegExp(`^${globSource(glob)}$`);
}

export function matchesAny(relPath, globs) {
  const p = toPosix(relPath);
  return globs.some((g) => globToRegExp(g).test(p));
}
