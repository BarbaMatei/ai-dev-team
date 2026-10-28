import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCsv } from './lib/csv.mjs';
import { Stop, runGh } from './lib/gh.mjs';
import { sumTokens } from './lib/logs.mjs';
import { loadConfig, projectRoot } from './lib/project.mjs';

export const COLUMNS = 'pr,branch,bolt_start,merged_at,hours_to_merge,review_rounds,findings_proven,findings_discarded,findings_unverified,tokens_total,tokens_input,tokens_cache_read,tokens_output,sessions,subagents'.split(',');
const REVIEW = /Rounds:\s*(\d+)\s*·\s*proven:\s*(\d+)\s*·\s*discarded:\s*(\d+)\s*·\s*unverified:\s*(\d+)/;
const NEEDS_SINCE = 'metrics: set metrics.since in .claude/ai-dev-team.json or start with --pr <n>';

export function parseReview(body) {
  const m = REVIEW.exec(body ?? '');
  return m ? { rounds: +m[1], proven: +m[2], discarded: +m[3], unverified: +m[4] } : null;
}

export function buildRow(pr, tokens) {
  const start = pr.commits.map((c) => c.authoredDate).sort((a, b) => Date.parse(a) - Date.parse(b))[0];
  const r = parseReview(pr.body) ?? {};
  const hours = ((Date.parse(pr.mergedAt) - Date.parse(start)) / 3600000).toFixed(1);
  return {
    pr: pr.number, branch: pr.headRefName, bolt_start: start, merged_at: pr.mergedAt, hours_to_merge: hours,
    review_rounds: r.rounds ?? '', findings_proven: r.proven ?? '', findings_discarded: r.discarded ?? '', findings_unverified: r.unverified ?? '',
    tokens_total: tokens.total, tokens_input: tokens.input, tokens_cache_read: tokens.cacheRead, tokens_output: tokens.output,
    sessions: tokens.sessions, subagents: tokens.subagents,
  };
}

const field = (v) => (/[,"\n\r]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
export const toCsvLine = (row) => COLUMNS.map((c) => field(row[c] ?? '')).join(',');

export function newPrs(merged, rows, since) {
  const done = new Set(rows.map((r) => String(r.pr)));
  let keep;
  if (since !== undefined) keep = (p) => p.number >= since;
  else {
    if (!rows.length) return [];
    const newest = Math.max(...rows.map((r) => Date.parse(r.merged_at)));
    keep = (p) => Date.parse(p.mergedAt) > newest;
  }
  return merged.filter((p) => !done.has(String(p.number)) && keep(p)).sort((a, b) => Date.parse(a.mergedAt) - Date.parse(b.mergedAt)).map((p) => p.number);
}

function git(root, args) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith('GIT_')) delete env[k];
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', env: args[0] === 'add' ? process.env : env });
  return r.status === 0 ? r.stdout.trim() : null;
}

function record(opts, out) {
  const root = projectRoot(process.cwd());
  let cfg;
  try {
    cfg = loadConfig(root);
  } catch (e) {
    throw new Stop(2, `metrics: ${e.message}`);
  }
  const rel = cfg.metrics?.file ?? 'metrics/bolts.csv';
  const file = path.join(root, rel);
  const rows = fs.existsSync(file) ? parseCsv(fs.readFileSync(file, 'utf8')) : [];
  const deadline = opts.hook ? Date.now() + opts.hookTimeout * 1000 : undefined;
  const ghJson = (args) => runGh(opts.gh, args, root, deadline && deadline - Date.now());
  let numbers;
  if (opts.pr) numbers = [opts.pr];
  else {
    if (!rows.length && cfg.metrics?.since === undefined) throw new Stop(2, NEEDS_SINCE);
    numbers = newPrs(ghJson(['pr', 'list', '--state', 'merged', '--json', 'number,mergedAt', '--limit', '100']), rows, cfg.metrics?.since);
  }
  const added = [];
  const lines = [];
  for (const n of numbers) {
    if (rows.some((r) => String(r.pr) === String(n))) {
      out(`PR #${n}: already recorded`);
      continue;
    }
    const pr = ghJson(['pr', 'view', n, '--json', 'number,headRefName,mergedAt,body,commits,state']);
    if (!pr.mergedAt || pr.state !== 'MERGED') throw new Stop(1, `PR #${n} is not merged`);
    const row = buildRow(pr, sumTokens(opts.logs, pr.headRefName, pr.mergedAt));
    added.push(row);
    lines.push(`PR #${n}: ${row.hours_to_merge}h, ${row.review_rounds === '' ? '-' : row.review_rounds} round(s), ${row.tokens_total} tokens → ${rel}`);
  }
  if (opts.dry) {
    if (added.length) out([COLUMNS.join(','), ...added.map(toCsvLine)].join('\n'));
    return added;
  }
  if (added.length) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const old = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    const header = old === '' ? `${COLUMNS.join(',')}\n` : old.endsWith('\n') ? '' : '\n';
    fs.appendFileSync(file, header + added.map((r) => `${toCsvLine(r)}\n`).join(''));
    lines.forEach(out);
    if (opts.hook) git(root, ['add', '--', rel]);
  }
  return added;
}

function parseArgs(argv) {
  const o = { gh: 'gh', hookTimeout: 15, logs: path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'projects') };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--pr') {
      o.pr = argv[++i];
      if (!/^\d+$/.test(o.pr ?? '')) throw new Stop(2, 'metrics: --pr needs a PR number');
    } else if (a === '--hook-timeout') o.hookTimeout = Number(argv[++i]);
    else if (a === '--sync') o.sync = true;
    else if (a === '--hook') o.hook = true;
    else if (a === '--dry-run') o.dry = true;
    else if (a === '--logs') o.logs = argv[++i];
    else if (a === '--gh') o.gh = argv[++i];
    else throw new Stop(2, `metrics: unknown argument ${a}`);
  }
  if (!o.pr && !o.sync && !o.hook) throw new Stop(2, 'metrics: usage: pr-metrics.mjs --pr <n> | --sync | --hook [--dry-run] [--logs <dir>] [--gh <command>] [--hook-timeout <seconds>]');
  return o;
}

function onDefaultOrDetached(root) {
  const head = git(root, ['symbolic-ref', '--short', 'HEAD']);
  if (!head) return true;
  const def = git(root, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])?.replace(/^origin\//, '') ?? 'main';
  return head === def;
}

function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
    if (opts.hook) {
      try {
        if (onDefaultOrDetached(projectRoot(process.cwd()))) return;
        const added = record(opts, () => {});
        if (added.length) process.stderr.write(`metrics: recorded PR #${added.map((r) => r.pr).join(', #')}\n`);
      } catch {}
      return;
    }
    record(opts, (l) => process.stdout.write(`${l}\n`));
  } catch (e) {
    if (!(e instanceof Stop)) throw e;
    process.stderr.write(`${e.message}\n`);
    process.exitCode = e.code;
  }
}

if (process.argv[1] && fs.realpathSync(path.resolve(process.argv[1])) === fs.realpathSync(fileURLToPath(import.meta.url))) main();
