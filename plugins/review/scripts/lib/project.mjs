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

const bad = (msg) => new Error(`.claude/ai-dev-team.json: ${msg}`);
const isStrings = (v) => Array.isArray(v) && v.every((s) => typeof s === 'string');

export function loadAreas(root, cfg, warn = () => {}) {
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
      const { globs, present } = frontmatterPaths(fs.readFileSync(path.join(dir, f), 'utf8'));
      if (present && !globs.length) warn(`${dirRel}/${f}: paths present but no globs parsed`);
      areas.push({ name: f.slice(0, -3), globs, ruleFile: `${dirRel}/${f}` });
    }
  }
  for (const [name, globs] of Object.entries(a ?? {})) {
    const hit = areas.find((x) => x.name === name);
    if (hit) hit.globs.push(...globs);
    else areas.push({ name, globs: [...globs], ruleFile: null });
  }
  return areas;
}

const unquote = (g) => g.trim().replace(/^["']|["']$/g, '').trim();

function frontmatterPaths(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return { globs: [], present: false };
  const lines = m[1].split(/\r?\n/);
  const at = lines.findIndex((l) => /^paths:/.test(l));
  if (at < 0) return { globs: [], present: false };
  let raw = lines[at].slice('paths:'.length).replace(/\s+#.*$/, '').trim();
  const items = [];
  if (raw === '') {
    for (const line of lines.slice(at + 1)) {
      const item = /^\s*-\s+(.*?)\s*$/.exec(line);
      if (!item) break;
      items.push(item[1]);
    }
  } else {
    if (raw.startsWith('[') && raw.endsWith(']')) raw = raw.slice(1, -1);
    items.push(...splitTop(raw));
  }
  return { globs: items.map(unquote).filter(Boolean), present: true };
}
