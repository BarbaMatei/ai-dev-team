import assert from 'node:assert/strict';
import fs from 'node:fs';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { base, put, repo, run as runIn } from './helpers.mjs';

const script = fileURLToPath(new URL('../scripts/criteria.mjs', import.meta.url));
const run = (dir, args) => runIn(script, dir, args);
after(() => fs.rmSync(base, { recursive: true, force: true }));

const STORY = '# Story\n\n## Acceptance Criteria\n\n- [ ] **Given** a, **When** b, **Then** c\n- [x] d\n\n### Edge\n\n- e\n\n## Notes\n\n- f\n';

describe('criteria.mjs', () => {
  it('lists criteria under the acceptance heading only', () => {
    const dir = repo({ 'story.md': STORY });
    const r = run(dir, ['story.md']);
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(r.out.trimEnd().split('\n'), ['story.md:5\tGiven a, When b, Then c', 'story.md:6\td', 'story.md:10\te', '3 criteria in 1 file(s)']);
  });

  it('expands a bolt into its stories', () => {
    const dir = repo({
      'mb/bolts/b1/bolt.md': '---\nintent: i1\nunit: u1\nstories: [s1]\n---\n# Bolt\n',
      'mb/intents/i1/units/u1/stories/s1.md': STORY,
    });
    const r = run(dir, ['mb/bolts/b1/bolt.md']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /^mb\/intents\/i1\/units\/u1\/stories\/s1\.md:5\tGiven a, When b, Then c\n/);
    assert.match(r.out, /3 criteria in 1 file\(s\)\n$/);
  });

  it('fails on a missing file', () => {
    const dir = repo({ 'x.md': '' });
    put(dir, 'x.md', '');
    const r = run(dir, ['nope.md']);
    assert.equal(r.code, 2);
    assert.equal(r.err.trim(), 'criteria: no such file nope.md');
  });
});
