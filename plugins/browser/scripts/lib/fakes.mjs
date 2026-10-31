import fs from 'node:fs';
import path from 'node:path';

const TYPES = {
  '.json': 'application/json',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain',
  '.html': 'text/html',
};
const KINDS = ['json', 'text', 'file'];
const bad = (n, msg) => Object.assign(new Error(`fake ${n}: ${msg}`), { code: 2 });
const escape = (p) => p.replace(/[.+^${}()|[\]\\]/g, '\\$&');
const wildcard = (p) => new RegExp(`^${escape(p).replace(/\*/g, '.*').replace(/\?/g, '.')}$`, 's');

export function parseFakes(list, stepsDir) {
  if (!Array.isArray(list)) throw bad(1, 'fake must be a list');
  return list.map((raw, i) => {
    const n = i + 1;
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw bad(n, 'must be an object');
    if (typeof raw.url !== 'string' || raw.url === '') throw bad(n, 'url must be a non-empty string');
    const kinds = KINDS.filter((k) => raw[k] !== undefined);
    if (kinds.length !== 1) throw bad(n, `needs exactly one of ${KINDS.join(', ')}`);
    if (raw.method !== undefined && (typeof raw.method !== 'string' || raw.method === '')) throw bad(n, 'method must be a string');
    const status = raw.status ?? 200;
    if (!(Number.isInteger(status) && status >= 100 && status <= 599)) throw bad(n, 'status must be an integer from 100 to 599');
    if (raw.type !== undefined && (typeof raw.type !== 'string' || raw.type === '')) throw bad(n, 'type must be a string');
    if (kinds[0] === 'text' && typeof raw.text !== 'string') throw bad(n, 'text must be a string');
    const fake = { ...raw, status };
    if (kinds[0] === 'file') {
      if (typeof raw.file !== 'string' || raw.file === '') throw bad(n, 'file must be a path');
      fake.file = path.resolve(stepsDir, raw.file);
      if (!fs.existsSync(fake.file)) throw bad(n, `file not found: ${fake.file}`);
    }
    return fake;
  });
}

export function matchFake(fakes, url, method) {
  const verb = method.toUpperCase();
  return fakes.find(
    (f) => wildcard(f.url).test(url) && (verb === 'OPTIONS' || !f.method || f.method.toUpperCase() === verb),
  );
}

export function bodyOf(fake) {
  if (fake.file !== undefined) return fs.readFileSync(fake.file);
  return Buffer.from(fake.json !== undefined ? JSON.stringify(fake.json) : fake.text);
}

const typeOf = (fake) =>
  fake.type ??
  (fake.file !== undefined
    ? (TYPES[path.extname(fake.file).toLowerCase()] ?? 'application/octet-stream')
    : fake.json !== undefined
      ? 'application/json'
      : 'text/plain');

export function fulfil(request, fake, bytes) {
  const header = (name) => Object.entries(request.headers ?? {}).find(([k]) => k.toLowerCase() === name)?.[1];
  const preflight = request.method.toUpperCase() === 'OPTIONS';
  const headers = preflight ? [] : [{ name: 'Content-Type', value: typeOf(fake) }];
  const origin = header('origin');
  if (origin) {
    headers.push(
      { name: 'Access-Control-Allow-Origin', value: origin },
      { name: 'Access-Control-Allow-Credentials', value: 'true' },
      { name: 'Access-Control-Allow-Headers', value: header('access-control-request-headers') ?? '*' },
      { name: 'Access-Control-Allow-Methods', value: 'GET,POST,PUT,PATCH,DELETE' },
    );
  }
  return {
    responseCode: preflight ? 204 : fake.status,
    responseHeaders: headers,
    body: preflight ? '' : bytes.toString('base64'),
  };
}
