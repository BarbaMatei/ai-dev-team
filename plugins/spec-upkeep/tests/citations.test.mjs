import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, extractCitations } from '../scripts/lib/citations.mjs';

test('classify recognises paths, symbols and commands', () => {
  for (const s of ['src/app/Order.cs', '.githooks', 'Order.cs:12']) assert.equal(classify(s), 'path', s);
  for (const s of ['OrderService.ExecuteUpdate()', 'guestSession', 'STORAGE_KEY']) assert.equal(classify(s), 'symbol', s);
  for (const s of ['npm run lint', 'dotnet test src/app']) assert.equal(classify(s), 'command', s);
});

test('classify skips placeholders, routes, globbed symbols and plain words', () => {
  const skipped = ['appsettings.{Environment}.Local.json', '/api/orders/{id}', 'STORAGE_TEST_*', 'bug', '<Namespace.OrClass>', '$HOME/x', 'a/b...', 'https://x.io/a', '--flag'];
  for (const s of skipped) assert.equal(classify(s), null, s);
});

test('extractCitations ignores non-shell fences and reads shell command lines', () => {
  const doc = ['```json', '{"p": "src/nope"}', '```', '```sh', '$ npm run lint', '```', 'see `src/a.cs` and [x](docs/b.md)'].join('\n');
  const got = extractCitations(doc);
  assert.deepEqual(got.map((c) => [c.line, c.kind, c.text]), [
    [5, 'command', 'npm run lint'],
    [7, 'path', 'src/a.cs'],
    [7, 'link', 'docs/b.md'],
  ]);
});

test('extractCitations gives the same line numbers for CRLF and LF', () => {
  const lines = ['# t', '', '```bash', 'git status', '```', '`src/a.cs`'];
  const lf = extractCitations(lines.join('\n'));
  assert.deepEqual(extractCitations(lines.join('\r\n')), lf);
  assert.deepEqual(lf.map((c) => c.line), [4, 6]);
});

test('extractCitations skips external and anchor links', () => {
  assert.deepEqual(extractCitations('[a](https://x.io) [b](#top) [c](mailto:a@b.io)'), []);
});

test('classify treats dotted type names and product names as symbols or skips them', () => {
  for (const s of ['System.Text.Json', 'Newtonsoft.Json', 'Foo.Xml']) assert.equal(classify(s), 'symbol', s);
  for (const s of ['Node.js', 'Vue.js', '@stripe/stripe-js', '@angular/cli']) assert.equal(classify(s), null, s);
});

test('classify keeps dot-prefixed paths only when they look like paths', () => {
  for (const s of ['.githooks', '.gitleaks.toml', '.env.example', '.claude/rules']) assert.equal(classify(s), 'path', s);
  for (const s of ['.scss', '.cshtml', '.ts', '.env', '.NET']) assert.equal(classify(s), null, s);
});

test('classify needs a lower-upper-lower run for a camel-case symbol', () => {
  for (const s of ['guestSession', 'PostgresTestDatabase', 'IStorageRouter', 'OnPush']) assert.equal(classify(s), 'symbol', s);
  for (const s of ['PostgreSQL', 'MinIO']) assert.equal(classify(s), null, s);
});
