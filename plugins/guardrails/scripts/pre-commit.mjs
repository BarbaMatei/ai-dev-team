import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { projectRoot, loadConfig, matchesAny } from './lib/project.mjs';
import { findSecrets, readSettings } from './checks.mjs';
import { newComments } from './lib/comments.mjs';

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

function hunks(paths) {
  const diff = git(['diff', '--cached', '--no-ext-diff', '--no-textconv', '--no-color', '-U0', '-M', '--', ...paths]);
  const out = [];
  let cur = null;
  let next = 0;
  for (const raw of diff.split('\n')) {
    const h = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (h) {
      next = Number(h[1]);
      cur = { removed: [], added: [] };
      out.push(cur);
    } else if (next > 0 && raw.startsWith('+')) {
      cur.added.push({ no: next++, text: raw.slice(1).replace(/\r$/, '') });
    } else if (next > 0 && raw.startsWith('-')) {
      cur.removed.push(raw.slice(1).replace(/\r$/, ''));
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
  const parts = hunks(old ? [old, file] : [file]);
  const added = parts.flatMap((h) => h.added);
  if (!matchesAny(file, allowPaths)) {
    for (const i of findSecrets(added.map((l) => l.text), extra)) secretHits.push(`${file}:${added[i - 1].no}`);
  }
  if (!merging && exts.includes(path.extname(file).toLowerCase())) {
    for (const h of parts) {
      for (const i of newComments(h.removed, h.added.map((l) => l.text))) commentHits.push(`${file}:${h.added[i].no}: ${h.added[i].text.trim()}`);
    }
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
  console.error('Comments are a last resort: a new comment line always stops here; an edited one passes only when it does not grow.');
  console.error('Delete or shorten the lines above, restage and commit again. Only if every listed line is allowed,');
  console.error('re-run the same commit with COMMENTS_OK=1 (never --no-verify).');
  process.exit(1);
}
