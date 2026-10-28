import fs from 'node:fs';
import path from 'node:path';
import { projectRoot, loadConfig, matchesAny, toPosix } from './lib/project.mjs';
import { findSecrets, isCommentLine, readSettings } from './checks.mjs';

const mode = process.argv[2];

function edits(tool, input) {
  if (tool === 'Write') return [{ old: '', text: input.content }];
  if (tool === 'Edit') return [{ old: input.old_string, text: input.new_string }];
  if (tool === 'MultiEdit' && Array.isArray(input.edits)) return input.edits.map((e) => ({ old: e?.old_string, text: e?.new_string }));
  return null;
}

function canonical(p) {
  const tail = [];
  let cur = p;
  for (;;) {
    try {
      return path.join(fs.realpathSync.native(cur), ...tail.reverse());
    } catch {
      const up = path.dirname(cur);
      if (up === cur) return p;
      tail.push(path.basename(cur));
      cur = up;
    }
  }
}

const lines = (s) => (typeof s === 'string' ? s.split(/\r?\n/) : []);

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => (raw += d));
process.stdin.on('end', () => {
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    return;
  }
  const list = input && typeof input.tool_input?.file_path === 'string' ? edits(input.tool_name, input.tool_input) : null;
  if (!list) return;

  const root = projectRoot(typeof input.cwd === 'string' ? input.cwd : process.cwd());
  let settings;
  try {
    settings = readSettings(loadConfig(root));
  } catch {
    settings = readSettings({});
  }
  const abs = input.tool_input.file_path;
  const rel = toPosix(path.relative(canonical(root), canonical(abs)));
  const out = [];

  if (mode === 'secrets') {
    if (matchesAny(rel, settings.allowPaths)) return;
    for (const e of list) {
      for (const i of findSecrets(lines(e.text), settings.patterns)) out.push(`[blocked] potential secret: ${rel}:${i} (line ${i} of the new text)`);
    }
    if (!out.length) return;
    out.push(settings.hint ?? 'Move the secret out of the repository.');
  } else if (mode === 'comments') {
    if (!settings.extensions.includes(path.extname(abs).toLowerCase())) return;
    for (const e of list) {
      const known = new Set(lines(e.old).map((l) => l.trim()));
      for (const l of lines(e.text)) if (isCommentLine(l) && !known.has(l.trim())) out.push(`  ${rel}: ${l.trim()}`);
    }
    if (!out.length) return;
    out.unshift('COMMENT GATE: this edit added comment lines:');
    out.push('Comments are a last resort: keep only a short line that explains a non-obvious why. Delete or shrink the lines above.');
  } else {
    return;
  }
  process.stderr.write(`${out.join('\n')}\n`, () => process.exit(2));
});
