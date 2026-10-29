export const DEFAULT_SECRET_PATTERNS = [
  '-----BEGIN [A-Z ]*PRIVATE KEY-----',
  'AKIA[0-9A-Z]{16}',
  'gh[pousr]_[0-9A-Za-z]{36}',
  'github_pat_[0-9A-Za-z_]{22,}',
  '(sk|rk)_live_[0-9A-Za-z]{16,}',
  'whsec_[0-9A-Za-z]{16,}',
  'xox[abprs]-[0-9A-Za-z-]{10,}',
  'AIza[0-9A-Za-z_-]{35}',
  'sk-ant-[0-9A-Za-z_-]{20,}',
  'sk-proj-[0-9A-Za-z_-]{20,}',
];

export const DEFAULT_COMMENT_EXTENSIONS = ['.cs', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.java', '.kt', '.go', '.rs', '.swift', '.c', '.cpp', '.h', '.scss'];

export function findSecrets(lines, extra = []) {
  const res = [...DEFAULT_SECRET_PATTERNS, ...extra].map((p) => new RegExp(p));
  const hits = [];
  lines.forEach((line, i) => {
    if (res.some((r) => r.test(line))) hits.push(i + 1);
  });
  return hits;
}

export function isCommentLine(line) {
  const t = line.trim();
  return t.startsWith('//') || t.startsWith('/*') || /\s\/\/(\s|$)/.test(line);
}

function strings(value, key) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) throw new Error(`.claude/ai-dev-team.json: ${key} must be an array of strings`);
  return value;
}

export function readSettings(cfg) {
  const secrets = cfg.secrets ?? {};
  const comments = cfg.comments ?? {};
  if (typeof secrets !== 'object' || Array.isArray(secrets)) throw new Error('.claude/ai-dev-team.json: secrets must be an object');
  if (typeof comments !== 'object' || Array.isArray(comments)) throw new Error('.claude/ai-dev-team.json: comments must be an object');
  if (secrets.hint !== undefined && typeof secrets.hint !== 'string') throw new Error('.claude/ai-dev-team.json: secrets.hint must be a string');
  const patterns = strings(secrets.patterns, 'secrets.patterns');
  for (const p of patterns) {
    try {
      new RegExp(p);
    } catch (e) {
      throw new Error(`.claude/ai-dev-team.json: secrets.patterns: ${e.message}`);
    }
  }
  const extensions = comments.extensions === undefined ? DEFAULT_COMMENT_EXTENSIONS : strings(comments.extensions, 'comments.extensions');
  return { patterns, allowPaths: strings(secrets.allowPaths, 'secrets.allowPaths'), hint: secrets.hint, extensions: extensions.map((e) => e.toLowerCase()) };
}

const ENV = String.raw`(?:\S+=\S*\s+)*`;
const DOTNET_TEST = new RegExp(String.raw`^${ENV}dotnet\s+test\b`);
const NPM_TEST = new RegExp(String.raw`^${ENV}(?:npm|pnpm|yarn)\s+(?:run\s+)?test(?=\s|$)`);
const NG_TEST = new RegExp(String.raw`^${ENV}(?:npx\s+)?ng\s+test\b`);
const VITEST = new RegExp(String.raw`^${ENV}(?:npx\s+)?vitest\b`);
const NPM_ONLY = new RegExp(String.raw`^${ENV}npm\s`);

export function unscopedTestReason(command, shell) {
  const stripped = command.replace(/"[^"]*"|'[^']*'/g, '');
  for (const raw of stripped.split(/&&|\|\||;|\||\r?\n/)) {
    const seg = raw.trim();
    if (DOTNET_TEST.test(seg)) {
      if (!/--filter\b|--list-tests\b/.test(seg)) return 'dotnet test without --filter runs the whole suite';
    } else if (NPM_TEST.test(seg) || NG_TEST.test(seg)) {
      const npm = NPM_TEST.test(seg);
      if (shell === 'powershell' && NPM_ONLY.test(seg)) return 'PowerShell drops the "--" before npm script arguments, so the filter never arrives; use npx ng test --include=... or run it in Bash';
      if (npm) {
        const after = seg.split(/\s--(?:\s|$)/).slice(1).join(' ').split(/\s+/).filter(Boolean);
        const scoped = after.some((a) => !a.startsWith('-') || /^(--include|-t$|--testNamePattern|--filter)/.test(a));
        if (!scoped) return 'npm test without a test filter runs the whole suite';
      } else if (!/--include\b/.test(seg)) return 'ng test without --include runs the whole suite';
    } else if (VITEST.test(seg)) {
      const args = seg.replace(VITEST, '').trim().split(/\s+/).filter(Boolean);
      const hasFile = args.some((a) => a !== 'run' && a !== 'watch' && !a.startsWith('-'));
      if (!hasFile && !args.some((a) => a === '-t' || a.startsWith('--testNamePattern'))) return 'vitest without a file or -t filter runs the whole suite';
    }
  }
  return null;
}

export function testGuardEnabled(cfg) {
  return cfg.testGuard !== false;
}
