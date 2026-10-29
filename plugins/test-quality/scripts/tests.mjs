import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, matchesAny, projectRoot, toPosix } from './lib/project.mjs';

const DEFAULT_GLOBS = ['**/*.test.*', '**/*.spec.*', '**/*Tests.cs', '**/*Test.cs', '**/*Test.java', '**/*Tests.java', '**/*Test.kt', '**/test_*.py', '**/*_test.py', '**/*_test.go'];
const SETUP_MAX = 80;
const JS = /^\s*(?:it|test)(?:\.(?:only|skip|concurrent|failing))?(?:\.each\(.*?\))?\(\s*(['"`])((?:\\.|(?!\1).)*)\1/;
const CS_ATTR = /^\s*\[(?:Fact|Theory|Test|TestMethod|TestCase|TestCaseSource|DataTestMethod|DataRow)\b/;
const CS_METHOD = /\b(?:void|Task|ValueTask)(?:<[^>]*>)?\s+(\w+)\s*\(/;
const JAVA_METHOD = /\b(?:void|fun)\s+(\w+)\s*\(/;

function fail(msg) {
  process.stderr.write(`test-quality: ${msg}\n`);
  process.exit(2);
}

export function findTests(lines, file) {
  const ext = path.extname(file).toLowerCase();
  const decls = [];
  let lastMethod = -1;
  const attributed = (attr, method) => {
    lines.forEach((text, i) => {
      if (!attr.test(text)) return;
      let j = i;
      if (!method.test(lines[i])) for (j = i + 1; j < lines.length && /^\s*(?:\[.*\]\s*|\/\/.*)?$/.test(lines[j]); j++);
      const m = j < lines.length && method.exec(lines[j]);
      if (!m) return;
      if (j !== lastMethod) decls.push({ line: i + 1, name: m[1] });
      lastMethod = j;
    });
  };
  if (ext === '.cs') attributed(CS_ATTR, CS_METHOD);
  else if (ext === '.java' || ext === '.kt') attributed(/^\s*@Test\b/, JAVA_METHOD);
  else {
    const re = ext === '.py' ? /^\s*(?:async\s+)?def\s+(test_\w*)\s*\(/ : ext === '.go' ? /^func\s+(Test\w*)\s*\(/ : null;
    lines.forEach((text, i) => {
      const m = re ? re.exec(text) : JS.exec(text);
      if (m) decls.push({ line: i + 1, name: re ? m[1] : m[2] });
    });
  }
  return decls;
}

export function changedTests(decls, addedLines, lineCount) {
  return decls
    .map((d, i) => ({ line: d.line, end: i + 1 < decls.length ? decls[i + 1].line - 1 : lineCount, name: d.name }))
    .filter((d) => {
      for (let l = d.line; l <= d.end; l++) if (addedLines.has(l)) return true;
      return false;
    });
}

// Bracket-balanced end: an added helper between tests is not part of the test above.
export function bodyEnd(lines, decl, limit, file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.py') {
    let end = decl.line;
    for (let l = decl.line + 1; l <= limit; l++) {
      if (lines[l - 1].trim() === '') continue;
      if (!/^\s/.test(lines[l - 1])) break;
      end = l;
    }
    return end;
  }
  const js = !['.cs', '.java', '.kt', '.go'].includes(ext);
  let depth = 0;
  let opened = false;
  for (let l = decl.line; l <= limit; l++) {
    for (const c of lines[l - 1]) {
      if (c === '{' || (js && c === '(')) {
        depth++;
        opened = true;
      } else if (c === '}' || (js && c === ')')) depth--;
    }
    if (opened && depth <= 0) return l;
  }
  return limit;
}

function bodyKey(lines, decls, i, file) {
  const limit = i + 1 < decls.length ? decls[i + 1].line - 1 : lines.length;
  const body = lines.slice(decls[i].line - 1, bodyEnd(lines, decls[i], limit, file)).join('');
  return `${decls[i].name}\0${body.replace(/\s+/g, '')}`;
}

function baseKeys(root, base, file) {
  const r = git(root, ['show', `${base}:${file}`]);
  if (r.status !== 0) return new Set();
  const lines = r.stdout.split(/\r?\n/);
  if (lines[lines.length - 1] === '') lines.pop();
  const decls = findTests(lines, file);
  return new Set(decls.map((_, i) => bodyKey(lines, decls, i, file)));
}

function git(cwd, args) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith('GIT_')) delete env[k];
  return spawnSync('git', ['-c', 'core.quotePath=false', ...args], { cwd, env, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
}

function findBase(root, explicit, given) {
  if (given && !explicit) fail('--base needs a ref');
  if (explicit) {
    const r = git(root, ['merge-base', 'HEAD', explicit]);
    if (r.status !== 0 || !r.stdout.trim()) fail(`unknown base ${explicit}`);
    return r.stdout.trim();
  }
  for (const ref of ['origin/HEAD', 'main']) {
    const r = git(root, ['merge-base', 'HEAD', ref]);
    if (r.status === 0 && r.stdout.trim()) return r.stdout.trim();
  }
  return fail('cannot find a base; pass --base <ref>');
}

function addedByFile(root, base) {
  const d = git(root, ['diff', '--no-color', '--no-renames', '--src-prefix=a/', '--dst-prefix=b/', '-U0', base]);
  if (d.status !== 0) fail(`git diff: ${(d.stderr || '').split('\n')[0]}`);
  const files = new Map();
  let set = null;
  let header = false;
  for (const line of d.stdout.split('\n')) {
    if (line.startsWith('diff --git ')) {
      header = true;
      set = null;
    } else if (header && line.startsWith('@@')) header = false;
    if (header && line.startsWith('+++ ')) {
      const p = line.slice(4).replace(/\t.*$/, '');
      set = null;
      if (p !== '/dev/null') files.set(toPosix(p.replace(/^b\//, '')), (set = new Set()));
    } else if (set && !header && line.startsWith('@@')) {
      const m = /\+(\d+)(?:,(\d+))?/.exec(line);
      const n = m[2] === undefined ? 1 : Number(m[2]);
      for (let i = 0; i < n; i++) set.add(Number(m[1]) + i);
    }
  }
  const u = git(root, ['ls-files', '-z', '--others', '--exclude-standard']);
  for (const f of u.stdout.split('\0').filter(Boolean)) files.set(toPosix(f), null);
  return files;
}

function collect(root, globs, base) {
  const out = [];
  const entries = [...addedByFile(root, base)].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  for (const [file, added] of entries) {
    if (!matchesAny(file, globs)) continue;
    let text;
    try {
      text = fs.readFileSync(path.join(root, ...file.split('/')), 'utf8');
    } catch {
      continue;
    }
    const lines = text.split(/\r?\n/);
    if (lines[lines.length - 1] === '') lines.pop();
    const decls = findTests(lines, file);
    const all = added ?? new Set(lines.map((_, i) => i + 1));
    const known = added ? baseKeys(root, base, file) : new Set();
    const tests = changedTests(decls, all, lines.length).filter((t) => !known.has(bodyKey(lines, decls, decls.findIndex((d) => d.line === t.line), file)));
    if (tests.length) out.push({ file, lines, tests, firstLine: decls[0].line });
  }
  return out;
}

function show(files) {
  for (const f of files) {
    const k = f.firstLine - 1;
    if (k >= 1) {
      process.stdout.write(`=== ${f.file} (setup, lines 1-${k})\n${f.lines.slice(0, Math.min(k, SETUP_MAX)).join('\n')}\n`);
      if (k > SETUP_MAX) process.stdout.write(`… (${k - SETUP_MAX} more lines)\n`);
    }
    for (const t of f.tests) process.stdout.write(`=== ${f.file}:${t.line}-${t.end} ${t.name}\n${f.lines.slice(t.line - 1, t.end).join('\n')}\n`);
  }
}

function main() {
  const [cmd, ...args] = process.argv.slice(2);
  if (!['list', 'show'].includes(cmd)) fail('usage: tests.mjs list|show [--base <ref>]');
  const root = projectRoot(process.cwd());
  let globs = DEFAULT_GLOBS;
  try {
    const g = loadConfig(root).testQuality?.testFiles;
    if (g !== undefined) {
      if (!Array.isArray(g) || !g.every((s) => typeof s === 'string')) throw new Error('.claude/ai-dev-team.json: testQuality.testFiles must be an array of strings');
      globs = g;
    }
  } catch (e) {
    fail(e.message);
  }
  const i = args.indexOf('--base');
  const given = args[i + 1];
  const files = collect(root, globs, findBase(root, given?.startsWith('--') ? undefined : given, i >= 0));
  const n = files.reduce((s, f) => s + f.tests.length, 0);
  if (!n) return void process.stdout.write('no new or changed tests\n');
  if (cmd === 'show') return show(files);
  for (const f of files) for (const t of f.tests) process.stdout.write(`${f.file}:${t.line}\t${t.name}\n`);
  process.stdout.write(`${n} new or changed test(s) in ${files.length} file(s)\n`);
}

if (process.argv[1] && fs.realpathSync(path.resolve(process.argv[1])) === fs.realpathSync(fileURLToPath(import.meta.url))) main();
