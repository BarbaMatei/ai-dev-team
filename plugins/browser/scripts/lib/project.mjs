import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

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

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function merge(base, over) {
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) if (k !== '__proto__') out[k] = isObject(v) && isObject(base[k]) ? merge(base[k], v) : v;
  return out;
}

export function loadLocalConfig(root) {
  const committed = loadConfig(root);
  const file = path.join(root, '.claude', 'ai-dev-team.local.json');
  if (!fs.existsSync(file)) return committed;
  try {
    const local = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!isObject(local)) throw new Error('expected a JSON object');
    return merge(committed, local);
  } catch (e) {
    throw new Error(`.claude/ai-dev-team.local.json: ${e.message}`);
  }
}
