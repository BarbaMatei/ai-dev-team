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

const bad = (msg) => new Error(`.claude/ai-dev-team.json: ${msg}`);
const isStrings = (v) => Array.isArray(v) && v.every((s) => typeof s === 'string');

export function loadAreas(root, cfg) {
  if (cfg.rulesDir !== undefined && typeof cfg.rulesDir !== 'string') throw bad('rulesDir must be a string');
  const a = cfg.areas;
  if (a !== undefined && (a === null || typeof a !== 'object' || Array.isArray(a) || !Object.values(a).every(isStrings))) {
    throw bad('areas must be an object of string arrays');
  }
  if (cfg.triggers !== undefined && !isStrings(cfg.triggers)) throw bad('triggers must be an array of strings');
  const dirRel = toPosix(cfg.rulesDir ?? '.claude/rules').replace(/\/+$/, '');
  const dir = path.join(root, dirRel);
  const areas = [];
  if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
    for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.md')).sort()) {
      areas.push({ name: f.slice(0, -3), globs: frontmatterPaths(fs.readFileSync(path.join(dir, f), 'utf8')), ruleFile: `${dirRel}/${f}` });
    }
  }
  for (const [name, globs] of Object.entries(a ?? {})) {
    const hit = areas.find((x) => x.name === name);
    if (hit) hit.globs.push(...globs);
    else areas.push({ name, globs: [...globs], ruleFile: null });
  }
  return areas;
}

function frontmatterPaths(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return [];
  const globs = [];
  let inPaths = false;
  for (const line of m[1].split(/\r?\n/)) {
    if (/^paths:\s*$/.test(line)) inPaths = true;
    else if (inPaths) {
      const item = /^\s+-\s+(.*?)\s*$/.exec(line);
      if (!item) break;
      globs.push(item[1].replace(/^(["'])(.*)\1$/, '$2'));
    }
  }
  return globs;
}
