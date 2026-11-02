const ROLES = ['api', 'web', 'lib'];
const RELEASE_REF = /^release-v\d+\.\d+\.\d+$/;

export class AnswersError extends Error {}

const fail = (key, msg) => {
  throw new AnswersError(`setup: answers${key ? `.${key}` : ''} ${msg}`);
};

function text(a, key, required) {
  const v = a[key];
  if (v === undefined && !required) return undefined;
  if (typeof v !== 'string' || v.trim() === '') fail(key, required ? 'must be a non-empty string' : 'must be a string when given');
  return v;
}

function oneOf(a, key, values) {
  if (!values.includes(a[key])) fail(key, `must be ${values.join(' or ')}`);
  return a[key];
}

const SEGMENT = /^[A-Za-z0-9._-]+$/;

function cleanDir(dir) {
  if (typeof dir !== 'string') return null;
  const d = dir.startsWith('./') ? dir.slice(2) : dir;
  if (d === '.') return d;
  return d.split('/').every((s) => SEGMENT.test(s) && s !== '.' && s !== '..') ? d : null;
}

export function validate(a, stackTable) {
  if (a === null || typeof a !== 'object' || Array.isArray(a)) fail('', 'must be a JSON object');
  const out = {};
  for (const k of ['name', 'language', 'owner']) out[k] = text(a, k, true);
  out.ownerType = oneOf(a, 'ownerType', ['User', 'Organization']);
  out.visibility = oneOf(a, 'visibility', ['public', 'private']);
  for (const k of ['purpose', 'users', 'mustDo']) text(a, k, false);
  if (!Array.isArray(a.stacks) || a.stacks.length === 0) fail('stacks', 'must be a non-empty list');
  const roles = new Set();
  out.stacks = a.stacks.map((s, i) => {
    const at = `stacks[${i}]`;
    if (s === null || typeof s !== 'object') fail(at, 'must be an object');
    if (!Object.hasOwn(stackTable, s.id)) fail(`${at}.id`, `must be one of ${Object.keys(stackTable).join(', ')}`);
    const dir = cleanDir(s.dir);
    if (dir === null) fail(`${at}.dir`, 'must be a relative folder of letters, digits, . _ - with / separators and no ..');
    if (!ROLES.includes(s.role)) fail(`${at}.role`, `must be ${ROLES.join(', ')}`);
    if (roles.has(s.role)) fail(`${at}.role`, `${s.role} is used by an earlier stack`);
    roles.add(s.role);
    return { id: s.id, dir, role: s.role };
  });
  out.release = oneOf(a, 'release', ['semantic-release', 'kit']);
  if (out.release === 'kit') {
    if (typeof a.releaseRef !== 'string' || !RELEASE_REF.test(a.releaseRef)) fail('releaseRef', 'must look like release-v1.2.3 when release is kit');
    out.releaseRef = a.releaseRef;
  }
  return out;
}
