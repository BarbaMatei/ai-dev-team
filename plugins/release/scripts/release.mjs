#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { prependSection, readVersion, replaceVersion, sectionBody } from './lib/changelog.mjs';
import { bumpFor, lastTag, nextVersion, readCommits, runGit, tagText } from './lib/commits.mjs';
import { loadConfig, projectRoot, toPosix } from './lib/project.mjs';

const fail = (msg) => {
  throw Object.assign(new Error(msg), { exit: 2 });
};
const bad = (key, why) => fail(`.claude/ai-dev-team.json: release${key ? `.${key}` : ''} ${why}`);

const git = runGit;

function gitOrThrow(root, args) {
  const r = git(root, args);
  if (!r.ok) throw new Error(`git ${args[0]} failed: ${r.err}`);
  return r.out;
}

function settings(raw) {
  const c = raw.release ?? {};
  if (c === null || typeof c !== 'object' || Array.isArray(c)) bad('', 'must be an object');
  const str = (k, d) => {
    if (c[k] !== undefined && (typeof c[k] !== 'string' || !c[k])) bad(k, 'must be a non-empty string');
    return c[k] ?? d;
  };
  const packages = c.packages ?? ['.'];
  if (!Array.isArray(packages) || !packages.length || !packages.every((p) => typeof p === 'string' && p)) bad('packages', 'must be a non-empty array of strings');
  const patch = c.patch ?? ['fix', 'perf'];
  if (patch !== 'any' && !(Array.isArray(patch) && patch.every((p) => typeof p === 'string'))) bad('patch', 'must be "any" or an array of strings');
  const tag = str('tag', 'v{version}');
  if (!tag.includes('{version}')) bad('tag', 'must contain {version}');
  const initial = str('initial', '0.1.0');
  if (!/^\d+\.\d+\.\d+$/.test(initial)) bad('initial', 'must look like 1.2.3');
  return { packages, patch, tag, initial, versionFile: str('versionFile'), changelog: str('changelog', 'CHANGELOG.md') };
}

function folders(root, globs) {
  const found = new Map();
  for (const glob of globs) {
    const g = toPosix(glob).replace(/^\.\//, '').replace(/\/+$/, '');
    if (path.isAbsolute(g) || g.split('/').includes('..')) bad('packages', `entry "${glob}" must stay inside the project`);
    const lit = path.join(root, g);
    if (!g.endsWith('/*') && fs.existsSync(lit) && !fs.statSync(lit).isDirectory()) bad('packages', `entry "${glob}" must be a folder`);
    const dirs = g.endsWith('/*') ? subfolders(root, g.slice(0, -2)) : fs.existsSync(lit) ? [g] : [];
    for (const d of dirs) found.set(d, { dir: d, abs: path.join(root, d), name: path.basename(d === '.' ? root : d) });
  }
  return [...found.values()];
}

function subfolders(root, parent) {
  const abs = path.join(root, parent);
  if (!fs.existsSync(abs)) return [];
  return fs
    .readdirSync(abs, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => (parent === '.' ? e.name : `${parent}/${e.name}`))
    .sort();
}

function plan(root, pkg, cfg, tags) {
  const vfile = cfg.versionFile ? path.join(pkg.abs, cfg.versionFile) : null;
  const vrel = vfile && toPosix(path.relative(root, vfile));
  const text = vfile && fs.existsSync(vfile) ? fs.readFileSync(vfile, 'utf8') : null;
  const fileVersion = text === null ? null : readVersion(text);
  const last = lastTag(tags, cfg.tag, pkg.name);
  let version;
  let commits = null;
  let bump = 'first';
  if (last) {
    commits = readCommits(root, last.tag, pkg.dir);
    bump = bumpFor(commits, cfg.patch, last.version);
    if (!bump) return null;
    version = nextVersion(last.version, bump);
  } else version = fileVersion ?? cfg.initial;
  if (text !== null && fileVersion === null) fail(`release: ${vrel} has no top-level "version"`);
  if (vfile && text === null && last) fail(`release: ${vrel} not found`);
  const current = last?.version ?? null;
  return { ...pkg, version, bump, current, commits, vfile: text === null ? null : vfile, text, tag: tagText(cfg.tag, pkg.name, version) };
}

function apply(root, plans, cfg, single) {
  const date = new Date().toISOString().slice(0, 10);
  const files = [];
  const created = [];
  try {
    for (const p of plans) {
      if (p.vfile && p.current !== null) {
        files.push(p.vfile);
        fs.writeFileSync(p.vfile, replaceVersion(p.text, p.version));
      }
      const log = path.join(p.abs, cfg.changelog);
      if (!fs.existsSync(log)) created.push(log);
      files.push(log);
      p.body = sectionBody(p.commits);
      prependSection(log, p.version, date, p.body);
    }
    gitOrThrow(root, ['add', '--', ...files.map((f) => toPosix(path.relative(root, f)))]);
    const label = single ? plans[0].version : plans.map((p) => `${p.name} ${p.version}`).join(', ');
    gitOrThrow(root, ['commit', '-q', '-m', `chore(release): ${label}`]);
  } catch (e) {
    const rel = files.map((f) => toPosix(path.relative(root, f)));
    git(root, ['reset', '-q', '--', ...rel]);
    for (const f of created) fs.rmSync(f, { force: true });
    git(root, ['checkout', '--', ...rel.filter((_, i) => !created.includes(files[i]))]);
    throw new Error(`release: could not commit the release, files restored: ${e.message.split(/\r?\n/)[0]}`);
  }
  for (const p of plans) {
    p.notes = path.join(os.tmpdir(), `release-${p.tag.replace(/[^A-Za-z0-9._-]/g, '-')}.md`);
    fs.writeFileSync(p.notes, p.body);
    gitOrThrow(root, ['tag', '-a', p.tag, '-m', `${p.name} ${p.version}`]);
  }
}

function main(argv) {
  const write = argv.includes('--write');
  if (argv.some((a) => a !== '--write')) fail('release: usage: release.mjs [--write]');
  const root = projectRoot(process.cwd());
  let cfg;
  try {
    cfg = settings(loadConfig(root));
  } catch (e) {
    fail(e.message);
  }
  if (write) {
    if (git(root, ['status', '--porcelain']).out.trim()) fail('release: the working tree has uncommitted changes');
    if (!git(root, ['var', 'GIT_COMMITTER_IDENT']).ok) fail('release: set git user.name and user.email');
  }
  const tags = gitOrThrow(root, ['tag', '--list']).split(/\r?\n/).filter(Boolean);
  const pkgs = folders(root, cfg.packages);
  const spaced = pkgs.find((p) => /\s/.test(p.name));
  if (spaced) fail(`release: package name "${spaced.name}" must not contain whitespace`);
  const plans = pkgs
    .map((p) => plan(root, p, cfg, tags))
    .filter(Boolean);
  for (const [i, p] of plans.entries()) {
    if (plans.findIndex((q) => q.tag === p.tag) !== i || git(root, ['rev-parse', '-q', '--verify', `refs/tags/${p.tag}`]).ok) fail(`release: tag ${p.tag} would be created twice or already exists`);
  }
  if (!plans.length) return console.log('nothing to release');
  if (!write) {
    for (const p of plans) console.log(`would release ${p.name} ${p.current ?? '-'} -> ${p.version} (${p.bump}) ${p.tag}`);
    return;
  }
  apply(root, plans, cfg, pkgs.length === 1);
  for (const p of plans) console.log(`release ${p.name} ${p.version} ${p.tag} ${p.notes}`);
}

try {
  main(process.argv.slice(2));
} catch (e) {
  process.stderr.write(`${e.message}\n`);
  process.exit(e.exit ?? 1);
}
