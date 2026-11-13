import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { loadLocalConfig } from '../scripts/lib/project.mjs';

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'browser project-'));
after(() => fs.rmSync(base, { recursive: true, force: true }));
let n = 0;

function repo(committed, local) {
  const dir = path.join(base, `p ${n++}`);
  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude', 'ai-dev-team.json'), JSON.stringify(committed));
  if (local !== undefined) fs.writeFileSync(path.join(dir, '.claude', 'ai-dev-team.local.json'), local);
  return dir;
}

test('loadLocalConfig merges objects, replaces arrays, and names the local file when it is invalid', () => {
  const dir = repo({ browser: { baseUrl: 'http://a', boot: [{ name: 'x' }], env: { A: '1', B: '2' } }, keep: 1 });
  assert.deepEqual(loadLocalConfig(dir).browser.boot, [{ name: 'x' }]);
  fs.writeFileSync(path.join(dir, '.claude', 'ai-dev-team.local.json'), JSON.stringify({ browser: { boot: [], env: { B: '3' } }, keep: null }));
  assert.deepEqual(loadLocalConfig(dir), { browser: { baseUrl: 'http://a', boot: [], env: { A: '1', B: '3' } }, keep: null });
  fs.writeFileSync(path.join(dir, '.claude', 'ai-dev-team.local.json'), '{nope');
  assert.throws(() => loadLocalConfig(dir), /^Error: \.claude\/ai-dev-team\.local\.json: /);
  fs.writeFileSync(path.join(dir, '.claude', 'ai-dev-team.local.json'), '[]');
  assert.throws(() => loadLocalConfig(dir), /^Error: \.claude\/ai-dev-team\.local\.json: expected a JSON object/);
});

test('loadLocalConfig ignores a __proto__ key in the local file', () => {
  const dir = repo({ keep: 1 }, '{"__proto__":{"polluted":true},"keep":2}');
  const cfg = loadLocalConfig(dir);
  assert.equal(cfg.keep, 2);
  assert.equal(cfg.polluted, undefined);
  assert.equal(Object.getPrototypeOf(cfg), Object.prototype);
});
