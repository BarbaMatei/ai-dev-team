import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { base, repo, run as runScript } from './helpers.mjs';

const script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'fix-setup.mjs');
after(() => fs.rmSync(base, { recursive: true, force: true }));

const lines = (r) => r.out.split('\n').slice(0, -1);
const fails = (config, line) => {
  const r = runScript(script, repo({}, config), []);
  assert.equal(r.code, 2, r.out + r.err);
  assert.equal(r.out, '');
  assert.equal(r.err, `${line}\n`);
};

test('no config prints every line with its fallback and exits 0', () => {
  const r = runScript(script, repo({}), []);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(lines(r), [
    'tests\tmissing\task the owner for the scoped test command; never run the whole suite',
    "app\tmissing\tbrowser.baseUrl is not set: ask the owner for the app's address; browser:drive cannot run",
    'start\tmissing\task the owner how they start the app',
    'accounts\tmissing\task the owner for a test account; never use a real one',
    'dataQuery\tmissing\task the owner for the record instead',
    'logs\tmissing\tstart an own copy (fix.apiCopy) and read its log, else ask the owner for the line',
    'apiCopy\tmissing\task the owner to copy the log line',
    'mail\tmissing\tpaths that send email are checked by tests only: say so before presenting the bug',
    "callers\tdefault\tthe LSP tool's call hierarchy, then Grep",
  ]);
});

test('a full config prints each value, the test kinds, the app address and the start commands', () => {
  const config = {
    tests: { api: { command: 'run api' }, ui: { command: 'run ui' } },
    browser: {
      baseUrl: 'http://localhost:4200',
      boot: [
        { name: 'db', ready: 'x', command: 'start db' },
        { name: 'web', ready: 'x', command: 'serve', cwd: 'web' },
        { name: 'noop', ready: 'x' },
        'junk',
      ],
    },
    fix: {
      accounts: 'demo@example.com / secret',
      dataQuery: 'query-tool --sql "{sql}"',
      logs: 'logs/app.log',
      apiCopy: 'serve --port {port}',
      mail: 'http://localhost:8025',
      callers: 'refs {symbol}',
    },
  };
  const r = runScript(script, repo({}, config), []);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(lines(r), [
    'tests\tapi,ui',
    'app\thttp://localhost:4200',
    'start\tdb: start db | web: serve (cwd web)',
    'accounts\tdemo@example.com / secret',
    'dataQuery\tquery-tool --sql "{sql}"',
    'logs\tlogs/app.log',
    'apiCopy\tserve --port {port}',
    'mail\thttp://localhost:8025',
    'callers\trefs {symbol}',
  ]);
});

test('dataQuery without {sql} exits 2 with one line', () => {
  fails({ fix: { dataQuery: 'query-tool' } }, '.claude/ai-dev-team.json: fix.dataQuery must contain {sql}');
});

test('apiCopy without {port} and callers without {symbol} exit 2', () => {
  fails({ fix: { apiCopy: 'serve' } }, '.claude/ai-dev-team.json: fix.apiCopy must contain {port}');
  fails({ fix: { callers: 'refs' } }, '.claude/ai-dev-team.json: fix.callers must contain {symbol}');
});

test('an unknown key under fix exits 2 naming it', () => {
  fails({ fix: { color: 'red' } }, '.claude/ai-dev-team.json: fix.color is not a known key');
  fails({ fix: { logs: '' } }, '.claude/ai-dev-team.json: fix.logs must be a non-empty string');
});

test('fix that is not an object exits 2', () => {
  fails({ fix: 'x' }, '.claude/ai-dev-team.json: fix must be an object');
  fails({ fix: [] }, '.claude/ai-dev-team.json: fix must be an object');
});

test('invalid JSON exits 2 with one line', () => {
  const r = runScript(script, repo({}, '{ nope'), []);
  assert.equal(r.code, 2);
  assert.match(r.err, /^\.claude\/ai-dev-team\.json: .+\n$/);
  assert.equal(r.err.trimEnd().split('\n').length, 1);
});
