import { spawnSync } from 'node:child_process';

const SEMVER = '(\\d+\\.\\d+\\.\\d+)';
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const KEEP = /^GIT_(AUTHOR|COMMITTER|CONFIG)/;

export function runGit(root, args) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith('GIT_') && !KEEP.test(k)) delete env[k];
  const r = spawnSync('git', args, { cwd: root, env, encoding: 'utf8', maxBuffer: 1 << 28 });
  return { ok: r.status === 0, out: r.stdout ?? '', err: (r.stderr ?? '').trim() };
}

export function tagText(pattern, name, version) {
  return pattern.replace(/{name}/g, () => name).replace(/{version}/g, () => version);
}

export function tagRegExp(pattern, name) {
  const parts = pattern.split(/(\{name\}|\{version\})/).map((p) => (p === '{name}' ? esc(name) : p === '{version}' ? SEMVER : esc(p)));
  return new RegExp(`^${parts.join('')}$`);
}

export function cmpVersions(a, b) {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
}

export function lastTag(tags, pattern, name) {
  const re = tagRegExp(pattern, name);
  let best = null;
  for (const tag of tags) {
    const m = re.exec(tag);
    if (m && (!best || cmpVersions(m[1], best.version) > 0)) best = { tag, version: m[1] };
  }
  return best;
}

export function parseCommit(sha, subject, body) {
  if (subject.startsWith('chore(release)')) return null;
  const m = /^(\w+)(?:\(([^)]*)\))?(!)?: (.+)$/.exec(subject);
  if (!m) return null;
  const breaking = Boolean(m[3]) || /^BREAKING[ -]CHANGE:/m.test(body);
  return { sha, type: m[1].toLowerCase(), breaking, text: m[4].trim() };
}

export function readCommits(root, from, dir) {
  const range = from ? [`${from}..HEAD`] : ['HEAD'];
  const r = runGit(root, ['log', ...range, '--no-merges', '--format=%H%x1f%s%x1f%b%x1e', '--', dir]);
  if (!r.ok) throw new Error(`git log failed: ${r.err}`);
  return r.out
    .split('\x1e')
    .map((rec) => rec.replace(/^\n/, ''))
    .filter(Boolean)
    .map((rec) => {
      const [sha, subject, body = ''] = rec.split('\x1f');
      return parseCommit(sha, subject, body);
    })
    .filter(Boolean);
}

export function bumpFor(commits, patch, current) {
  let level = 0;
  for (const c of commits) {
    if (c.breaking) level = Math.max(level, current.startsWith('0.') ? 2 : 3);
    else if (c.type === 'feat') level = Math.max(level, 2);
    else if (patch === 'any' || patch.includes(c.type)) level = Math.max(level, 1);
  }
  return [null, 'patch', 'minor', 'major'][level];
}

export function nextVersion(current, bump) {
  const [ma, mi, pa] = current.split('.').map(Number);
  if (bump === 'major') return `${ma + 1}.0.0`;
  if (bump === 'minor') return `${ma}.${mi + 1}.0`;
  return `${ma}.${mi}.${pa + 1}`;
}
