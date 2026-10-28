import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { sumTokens } from '../scripts/lib/logs.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-logs-'));
after(() => fs.rmSync(dir, { recursive: true, force: true }));

const line = (id, branch, ts, u, extra = {}) =>
  JSON.stringify({ type: 'assistant', timestamp: ts, gitBranch: branch, requestId: `req_${id}`, message: { id, usage: { input_tokens: u[0], cache_creation_input_tokens: u[1], cache_read_input_tokens: u[2], output_tokens: u[3] } }, ...extra });

function write(rel, lines) {
  const f = path.join(dir, ...rel.split('/'));
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, lines.join('\n') + '\n');
}

test('sums deduped assistant usage on the branch up to the merge time', () => {
  write('p1/s1.jsonl', [
    line('m1', 'feat/x', '2026-01-01T10:00:00.123Z', [10, 5, 100, 7]),
    line('m1', 'feat/x', '2026-01-01T10:00:01Z', [10, 5, 100, 7]),
    line('m2', 'feat/x', '2026-01-01T10:05:00Z', [1, 0, 0, 1]),
    line('m3', 'feat/x', '2026-01-01T12:00:00.500Z', [99, 99, 99, 99]),
    line('m4', 'main', '2026-01-01T10:06:00Z', [99, 99, 99, 99]),
    'not json "gitBranch":"feat/x"',
  ]);
  write('p1/s1/subagents/agent-a.jsonl', [line('m5', 'feat/x', '2026-01-01T10:10:00Z', [2, 0, 50, 3])]);
  write('p1/s1/subagents/agent-a.meta.json', ['{}']);
  write('p2/s2.jsonl', [line('m6', 'other', '2026-01-01T10:00:00Z', [50, 0, 0, 50])]);
  assert.deepEqual(sumTokens(dir, 'feat/x', '2026-01-01T12:00:00Z'), { input: 18, cacheRead: 150, output: 11, total: 179, sessions: 1, subagents: 1 });
});

test('a missing projects dir sums to zero', () => {
  assert.deepEqual(sumTokens(path.join(dir, 'nope'), 'feat/x', '2026-01-01T12:00:00Z'), { input: 0, cacheRead: 0, output: 0, total: 0, sessions: 0, subagents: 0 });
});
