import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, projectRoot } from './lib/project.mjs';

function fail(msg) {
  process.stderr.write(`ui-review: ${msg}\n`);
  process.exit(2);
}

const stripBlock = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '');
const stripLine = (t) => t.replace(/(^|[\s;{}])\/\/.*$/gm, '$1');
const tidy = (v) => v.replace(/!(default|global)/g, '').replace(/\s+/g, ' ').trim();
const FUNC_OK = /^(rgba?|hsla?)\(/;

function resolveAliases(raw, ref) {
  const out = new Map();
  for (const name of raw.keys()) {
    let v = raw.get(name);
    const seen = new Set([name]);
    for (let m = ref.exec(v); m; m = ref.exec(v)) {
      if (seen.has(m[1]) || !raw.has(m[1])) {
        v = null;
        break;
      }
      seen.add(m[1]);
      v = raw.get(m[1]);
    }
    if (v !== null) out.set(name, v);
  }
  return out;
}

function parseScss(text) {
  const raw = new Map();
  let depth = 0;
  let stmt = '';
  for (const c of stripLine(stripBlock(text))) {
    if (c === '{') depth++;
    else if (c === '}') depth = Math.max(0, depth - 1);
    else if (depth === 0 && c === ';') {
      const m = /^\s*\$([\w-]+)\s*:([\s\S]*)$/.exec(stmt);
      if (m) {
        const v = tidy(m[2]);
        if (v && !v.startsWith('(') && (!/[$(]/.test(v) || FUNC_OK.test(v) || /^\$[\w-]+$/.test(v))) raw.set(m[1], v);
      }
      stmt = '';
    } else if (depth === 0) stmt += c;
    if (c === '}' && depth === 0) stmt = '';
  }
  return resolveAliases(raw, /^\$([\w-]+)$/);
}

function parseCss(text) {
  const raw = new Map();
  for (const m of stripBlock(text).matchAll(/(--[\w-]+)\s*:\s*([^;}]+)/g)) raw.set(m[1], tidy(m[2]));
  return resolveAliases(raw, /^var\(\s*(--[\w-]+)\s*\)$/);
}

function parseJson(text, file) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    fail(`${file}: ${e.message}`);
  }
  const out = new Map();
  const walk = (node, prefix) => {
    for (const [k, v] of Object.entries(node)) {
      const key = prefix ? `${prefix}.${k}` : k;
      if (v !== null && typeof v === 'object') walk(v, key);
      else if (typeof v === 'string' || typeof v === 'number') out.set(key, String(v));
    }
  };
  if (data !== null && typeof data === 'object') walk(data, '');
  return out;
}

function loadTokens(cwd) {
  const root = projectRoot(cwd);
  let cfg;
  try {
    cfg = loadConfig(root);
  } catch (e) {
    fail(e.message);
  }
  const ui = cfg.uiReview;
  if (ui !== undefined && (ui === null || typeof ui !== 'object' || Array.isArray(ui))) fail('uiReview must be an object');
  const files = ui?.tokens;
  if (files === undefined || (Array.isArray(files) && !files.length)) fail('set uiReview.tokens');
  if (!Array.isArray(files) || !files.every((f) => typeof f === 'string')) fail('uiReview.tokens must be an array of file paths');
  const all = new Map();
  for (const f of files) {
    const full = path.resolve(root, f);
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) fail(`no such token file ${f}`);
    const text = fs.readFileSync(full, 'utf8');
    const ext = path.extname(f).toLowerCase();
    const parsed = ext === '.json' ? parseJson(text, f) : ext === '.css' ? parseCss(text) : parseScss(text);
    for (const [k, v] of parsed) all.set(k, v);
  }
  return all;
}

function toRgb(spec, tokens) {
  let v = spec;
  if (!v.startsWith('#')) {
    v = tokens.get(v) ?? tokens.get(v.replace(/^\$/, ''));
    if (v === undefined) fail(`no token named ${spec}`);
  }
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v);
  if (!m) fail(`${spec} is ${v}, not a hex colour`);
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

function luminance(rgb) {
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === 'list') {
  for (const [k, v] of loadTokens(process.cwd())) process.stdout.write(`${k}\t${v}\n`);
} else if (cmd === 'contrast' && rest.length === 2) {
  const tokens = loadTokens(process.cwd());
  const [l1, l2] = rest.map((s) => luminance(toRgb(s, tokens)));
  const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  process.stdout.write(`${ratio.toFixed(2)}:1\n`);
} else fail('usage: tokens.mjs list | contrast <a> <b>');
