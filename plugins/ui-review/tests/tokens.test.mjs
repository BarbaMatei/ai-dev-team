import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../scripts/tokens.mjs', import.meta.url));
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'uir-'));
after(() => fs.rmSync(base, { recursive: true, force: true }));
let n = 0;

function project(files, config) {
  const dir = path.join(base, `p${n++}`);
  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
  if (config !== undefined) fs.writeFileSync(path.join(dir, '.claude', 'ai-dev-team.json'), typeof config === 'string' ? config : JSON.stringify(config));
  for (const [rel, c] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), c);
  }
  return dir;
}

function run(dir, args) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith('GIT_')) delete env[k];
  const r = spawnSync(process.execPath, [script, ...args], { cwd: dir, env, encoding: 'utf8' });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

const lines = (r) => r.out.trimEnd().split('\n');

describe('tokens.mjs list', () => {
  it('strips comments and resolves aliases in SCSS', () => {
    const dir = project(
      { 's.scss': '// line comment\n$b: #1a73e8; // trailing\n/* block\n$hidden: #000000;\n*/\n$a: $b;\n$c: $a !default;\n' },
      { uiReview: { tokens: ['s.scss'] } },
    );
    const r = run(dir, ['list']);
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(lines(r), ['b\t#1a73e8', 'a\t#1a73e8', 'c\t#1a73e8']);
  });

  it('skips SCSS maps, mixins and a cyclic alias', () => {
    const scss = '$map: (\n  a: 1,\n  b: 2\n);\n@mixin m {\n  $inner: 5px;\n}\n$x: $y;\n$y: $x;\n$ok: 4px;\n';
    const dir = project({ 's.scss': scss }, { uiReview: { tokens: ['s.scss'] } });
    const r = run(dir, ['list']);
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(lines(r), ['ok\t4px']);
  });

  it('lists CSS custom properties with their dashes', () => {
    const dir = project({ 't.css': ':root {\n  --space-2: 8px;\n}\n' }, { uiReview: { tokens: ['t.css'] } });
    assert.deepEqual(lines(run(dir, ['list'])), ['--space-2\t8px']);
  });

  it('joins nested JSON keys with a dot', () => {
    const dir = project({ 't.json': '{ "color": { "primary": "#112233" } }' }, { uiReview: { tokens: ['t.json'] } });
    assert.deepEqual(lines(run(dir, ['list'])), ['color.primary\t#112233']);
  });

  it('keeps the next token after a protocol-relative url value', () => {
    const dir = project({ 's.scss': '$icon: url(//cdn.example.com/a.png);\n$ink: #000;\n' }, { uiReview: { tokens: ['s.scss'] } });
    const r = run(dir, ['list']);
    assert.equal(r.code, 0, r.err);
    assert.ok(lines(r).includes('ink\t#000'), r.out);
  });

  it('exits 2 with one line on invalid config JSON', () => {
    const r = run(project({}, '{ nope'), ['list']);
    assert.equal(r.code, 2);
    assert.equal(r.err.trim().split('\n').length, 1);
  });

  it('exits 2 when uiReview.tokens is not set', () => {
    const r = run(project({}), ['list']);
    assert.equal(r.code, 2);
    assert.equal(r.err.trim(), 'ui-review: set uiReview.tokens');
  });
});

describe('tokens.mjs contrast', () => {
  const dir = project({ 's.scss': '$ink: #000;\n$paper: #ffffff;\n$accent: rgba(0, 0, 0, 0.5);\n' }, { uiReview: { tokens: ['s.scss'] } });

  it('gives 21.00:1 for black on white', () => {
    assert.equal(run(dir, ['contrast', '#000', '#fff']).out.trim(), '21.00:1');
  });

  it('gives 4.54:1 for #767676 on white', () => {
    assert.equal(run(dir, ['contrast', '#767676', '#ffffff']).out.trim(), '4.54:1');
  });

  it('resolves token names', () => {
    assert.equal(run(dir, ['contrast', 'ink', 'paper']).out.trim(), '21.00:1');
  });

  it('exits 2 with one line when a token is not a hex colour', () => {
    const r = run(dir, ['contrast', 'accent', 'paper']);
    assert.equal(r.code, 2);
    assert.equal(r.err.trim().split('\n').length, 1);
    assert.match(r.err, /accent/);
  });

  it('exits 2 when uiReview.tokens is not set', () => {
    const r = run(project({}), ['contrast', '#000', '#fff']);
    assert.equal(r.code, 2);
    assert.equal(r.err.trim(), 'ui-review: set uiReview.tokens');
  });
});
