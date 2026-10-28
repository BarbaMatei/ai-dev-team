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
