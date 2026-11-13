import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { base, repo, put } from './helpers.mjs';
import { loadLocalConfig } from '../scripts/lib/project.mjs';

after(() => fs.rmSync(base, { recursive: true, force: true }));

test('loadLocalConfig merges objects, replaces arrays, and names the local file when it is invalid', () => {
  const dir = repo({}, { tests: { u: { command: 'a', env: { A: '1', B: '2' } } }, triggers: ['x', 'y'], keep: 1 });
  assert.deepEqual(loadLocalConfig(dir).triggers, ['x', 'y']);
  put(dir, '.claude/ai-dev-team.local.json', JSON.stringify({ tests: { u: { env: { B: '3' } } }, triggers: ['z'], keep: null }));
  assert.deepEqual(loadLocalConfig(dir), { tests: { u: { command: 'a', env: { A: '1', B: '3' } } }, triggers: ['z'], keep: null });
  put(dir, '.claude/ai-dev-team.local.json', '{nope');
  assert.throws(() => loadLocalConfig(dir), /^Error: \.claude\/ai-dev-team\.local\.json: /);
  put(dir, '.claude/ai-dev-team.local.json', '[]');
  assert.throws(() => loadLocalConfig(dir), /^Error: \.claude\/ai-dev-team\.local\.json: expected a JSON object/);
});
