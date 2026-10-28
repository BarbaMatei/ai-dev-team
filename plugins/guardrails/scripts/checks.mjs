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
