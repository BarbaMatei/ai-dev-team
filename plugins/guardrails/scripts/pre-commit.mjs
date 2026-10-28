import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { projectRoot, loadConfig, matchesAny } from './lib/project.mjs';
import { findSecrets, isCommentLine, DEFAULT_COMMENT_EXTENSIONS } from './checks.mjs';

const root = projectRoot(process.cwd());
let config;
try {
  config = loadConfig(root);
} catch (e) {
  process.stderr.write(`guardrails: ${e.message}\n`);
  process.exit(2);
}

function git(args) {
  const env = { ...process.env };
  delete env.GIT_EXTERNAL_DIFF;
  const r = spawnSync('git', args, { cwd: root, env, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (r.status !== 0) {
    process.stderr.write(`guardrails: git ${args[0]} failed\n`);
    process.exit(2);
  }
  return r.stdout;
}

function addedLines(file) {
  const diff = git(['diff', '--cached', '--no-color', '-U0', '--', file]);
  const out = [];
  let next = 0;
  for (const raw of diff.split('\n')) {
    const h = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (h) {
      next = Number(h[1]);
    } else if (next > 0 && raw.startsWith('+') && !raw.startsWith('+++')) {
      out.push({ no: next++, text: raw.slice(1).replace(/\r$/, '') });
    }
  }
  return out;
}

const files = git(['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z']).split('\0').filter(Boolean);
const allowPaths = config.secrets?.allowPaths ?? [];
const extra = config.secrets?.patterns ?? [];
const exts = (config.comments?.extensions ?? DEFAULT_COMMENT_EXTENSIONS).map((e) => e.toLowerCase());

const secretHits = [];
const commentHits = [];
for (const file of files) {
  const added = addedLines(file);
  if (!matchesAny(file, allowPaths)) {
    for (const i of findSecrets(added.map((l) => l.text), extra)) secretHits.push(`${file}:${added[i - 1].no}`);
  }
  if (exts.includes(path.extname(file).toLowerCase())) {
    for (const l of added) if (isCommentLine(l.text)) commentHits.push(`${file}:${l.no}: ${l.text.trim()}`);
  }
}

if (secretHits.length) {
  for (const h of secretHits) console.error(`[blocked] potential secret: ${h}`);
  console.error(`Commit blocked (secret guard). ${config.secrets?.hint ?? 'Move the secret out of the repository.'}`);
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
