import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AnswersError } from './lib/answers.mjs';
import { GhError, makeGh } from './lib/gh-run.mjs';
import { LABELS, RULESET_NAME, keyScript, rulesetBody } from './lib/github-shapes.mjs';
import { ciJobNames } from './render.mjs';

const USAGE = 'github: usage: github.mjs plan|apply <answers.json> [--gh <command>] | owner <login> [--gh <command>]';
const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO = /^(?!\.{1,2}$)[A-Za-z0-9._-]{1,100}$/;

class Stop extends Error {
  constructor(code, msg) {
    super(msg);
    this.code = code;
  }
}

function slugOf(owner, repo) {
  if (!OWNER.test(owner) || !REPO.test(repo)) throw new Stop(2, `github: ${owner}/${repo} is not a valid GitHub owner/repository`);
  return { owner, repo, slug: `${owner}/${repo}` };
}

function originSlug(cwd) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith('GIT_')) delete env[k];
  const r = spawnSync('git', ['remote', 'get-url', 'origin'], { cwd, env, encoding: 'utf8' });
  if (r.status !== 0) return null;
  const m = /[/:]([^/:]+)\/([^/:]+?)(?:\.git)?\/?$/.exec(r.stdout.trim());
  if (!m) throw new Stop(2, `github: cannot read owner/repository from origin ${r.stdout.trim()}`);
  return slugOf(m[1], m[2]);
}

function parseArgs(argv) {
  const o = { gh: 'gh' };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--gh') {
      o.gh = argv[++i];
      if (!o.gh?.trim()) throw new Stop(2, 'github: --gh needs a command');
    } else rest.push(argv[i]);
  }
  if (rest.length !== 2 || !['plan', 'apply', 'owner'].includes(rest[0])) throw new Stop(2, USAGE);
  [o.cmd, o.arg] = rest;
  return o;
}

function readAnswers(file) {
  let a;
  try {
    a = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    throw new Stop(2, `github: cannot read answers ${file}: ${e.code ?? 'invalid JSON'}`);
  }
  return { a, checks: ciJobNames(a) };
}

function step(name, fn) {
  try {
    return fn();
  } catch (e) {
    if (e instanceof GhError) throw new Stop(1, `github: ${name} failed: ${e.message}`);
    throw e;
  }
}

function inspect(gh, a, checks, repo) {
  const missing = repo.existing
    ? step('labels', () => {
        const have = new Set(JSON.parse(gh(['label', 'list', '-R', repo.slug, '--json', 'name', '--limit', '200'])).map((l) => l.name));
        return LABELS.filter((l) => !have.has(l.name));
      })
    : LABELS;
  let protection = 'new';
  if (repo.existing) {
    try {
      const list = JSON.parse(gh(['api', `repos/${repo.slug}/rulesets`]));
      if (list.some((r) => r.name === RULESET_NAME)) protection = 'exists';
    } catch (e) {
      if (!(e instanceof GhError)) throw e;
      if (!e.forbidden) throw new Stop(1, `github: protection failed: ${e.message}`);
      protection = `unavailable: ${e.message}`;
    }
  }
  return { missing, protection, checks };
}

function execute(gh, a, repo, state, out) {
  if (!repo.existing) {
    step('repo create', () => gh(['repo', 'create', repo.slug, `--${a.visibility}`, '--source', '.', '--remote', 'origin', '--push']));
    out(`repo created ${repo.slug}`);
  }
  if (state.missing.length === 0) out('labels present');
  else {
    for (const l of state.missing) step(`label ${l.name}`, () => gh(['label', 'create', l.name, '-R', repo.slug, '--color', l.color, '--description', l.description]));
    out(`labels created ${state.missing.map((l) => l.name).join(' ')}`);
  }
  let { protection } = state;
  if (protection === 'new') {
    try {
      gh(['api', '-X', 'POST', `repos/${repo.slug}/rulesets`, '--input', '-'], JSON.stringify(rulesetBody(state.checks, a.ownerType)));
      protection = 'applied';
    } catch (e) {
      if (!(e instanceof GhError)) throw e;
      if (!e.forbidden) throw new Stop(1, `github: protection failed: ${e.message}`);
      protection = `unavailable: ${e.message}`;
    }
  }
  out(`protection ${protection}`);
  return protection === 'applied' || protection === 'exists';
}

const keyPath = (repo) => path.join(os.tmpdir(), `make-release-key-${repo.repo}.sh`);

function run(o, out) {
  const gh = makeGh(o.gh, process.cwd());
  if (o.cmd === 'owner') {
    if (!OWNER.test(o.arg)) throw new Stop(2, `github: ${o.arg} is not a valid GitHub login`);
    out(step('owner', () => gh(['api', `users/${o.arg}`, '--jq', '.type'])).trim());
    return;
  }
  const { a, checks } = readAnswers(o.arg);
  const origin = originSlug(process.cwd());
  const repo = origin ? { ...origin, existing: true } : { ...slugOf(a.owner, a.name), existing: false };
  const state = inspect(gh, a, checks, repo);
  const user = a.ownerType === 'User';
  if (o.cmd === 'plan') {
    if (!repo.existing) out(`repo create ${repo.slug} ${a.visibility}`);
    out(state.missing.length ? `labels ${state.missing.map((l) => l.name).join(' ')}` : 'labels present');
    if (state.protection === 'new') out(`protection ruleset ${checks.join(',')} bypass ${user ? 'deploy-key' : 'actions'}${a.visibility === 'private' ? ' (private: needs a paid plan)' : ''}`);
    else out(`protection ${state.protection}`);
    if (user) out(`release-key ${keyPath(repo)}${a.visibility === 'private' ? ' (only if protection applies)' : ''}`);
    return;
  }
  const protectedNow = execute(gh, a, repo, state, out);
  if (!user) return;
  if (!protectedNow) return out('release-key skipped: no protection; releases use the built-in token');
  fs.writeFileSync(keyPath(repo), keyScript(repo.slug), { mode: 0o755 });
  fs.chmodSync(keyPath(repo), 0o755);
  out(`release-key ${keyPath(repo)}`);
}

try {
  run(parseArgs(process.argv.slice(2)), (line) => console.log(line));
} catch (e) {
  if (e instanceof Stop || e instanceof AnswersError) {
    console.error(e.message);
    process.exit(e.code ?? 2);
  }
  throw e;
}
