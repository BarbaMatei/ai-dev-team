import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { projectRoot, loadConfig, matchesAny } from './lib/project.mjs';
import { findSecrets, isCommentLine, readSettings } from './checks.mjs';

const root = projectRoot(process.cwd());
let config;
let settings;
try {
  config = loadConfig(root);
  settings = readSettings(config);
} catch (e) {
  process.stderr.write(`guardrails: ${e.message}\n`);
  process.exit(2);
}

function git(args) {
  const env = { ...process.env };
  delete env.GIT_EXTERNAL_DIFF;
  env.GIT_LITERAL_PATHSPECS = '1';
  const r = spawnSync('git', args, { cwd: root, env, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (r.status !== 0) {
    process.stderr.write(`guardrails: git ${args[0]} failed\n`);
    process.exit(2);
  }
  return r.stdout;
}

function addedLines(paths) {
  const diff = git(['diff', '--cached', '--no-ext-diff', '--no-textconv', '--no-color', '-U0', '-M', '--', ...paths]);
  const out = [];
  let next = 0;
  for (const raw of diff.split('\n')) {
    const h = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (h) {
      next = Number(h[1]);
    } else if (next > 0 && raw.startsWith('+')) {
      out.push({ no: next++, text: raw.slice(1).replace(/\r$/, '') });
    }
  }
  return out;
}

const merging = fs.existsSync(path.resolve(root, git(['rev-parse', '--git-path', 'MERGE_HEAD']).trim()));
const entries = [];
const fields = git(['diff', '--cached', '--no-ext-diff', '--name-status', '-M', '-z', '--diff-filter=ACMR']).split('\0').filter(Boolean);
for (let i = 0; i < fields.length; i++) {
  if (/^[RC]/.test(fields[i])) {
    entries.push([fields[i + 1], fields[i + 2]]);
    i += 2;
  } else {
    entries.push([null, fields[i + 1]]);
    i++;
  }
}
const { allowPaths, patterns: extra, extensions: exts, hint } = settings;

const secretHits = [];
const commentHits = [];
for (const [old, file] of entries) {
  const added = addedLines(old ? [old, file] : [file]);
  if (!matchesAny(file, allowPaths)) {
    for (const i of findSecrets(added.map((l) => l.text), extra)) secretHits.push(`${file}:${added[i - 1].no}`);
  }
  if (!merging && exts.includes(path.extname(file).toLowerCase())) {
    for (const l of added) if (isCommentLine(l.text)) commentHits.push(`${file}:${l.no}: ${l.text.trim()}`);
  }
}

if (secretHits.length) {
  for (const h of secretHits) console.error(`[blocked] potential secret: ${h}`);
  console.error(`Commit blocked (secret guard). ${hint ??'Move the secret out of the repository.'}`);
  process.exit(1);
}

if (commentHits.length && !process.env.COMMENTS_OK) {
  console.error('COMMENT GATE: added comment lines in this commit:');
  for (const h of commentHits) console.error(`  ${h}`);
  console.error('');
  console.error('Comments are a last resort: keep only a short line that explains a non-obvious why,');
  console.error('or a short doc comment where the project allows one. Delete or shrink the lines');
  console.error('above, restage and commit again. Only if every listed line is allowed, re-run the');
  console.error('same commit with COMMENTS_OK=1 (never --no-verify).');
  process.exit(1);
}
