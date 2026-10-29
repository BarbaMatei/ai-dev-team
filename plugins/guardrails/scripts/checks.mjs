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

function heredocEnd(command, from, delim) {
  let start = from;
  while (start < command.length) {
    const nl = command.indexOf('\n', start);
    const end = nl < 0 ? command.length : nl;
    if (command.slice(start, end).trim() === delim) return end;
    start = end + 1;
  }
  return command.length;
}

function segments(command, shell) {
  const esc = shell === 'powershell' ? '`' : '\\';
  const out = [];
  const delims = [];
  let seg = [];
  let word = '';
  let inWord = false;
  let quote = null;
  let target = null;
  const endWord = () => {
    if (!inWord) return;
    if (target === 'heredoc') delims.push(word);
    else if (target !== 'redirect') seg.push(word);
    target = null;
    word = '';
    inWord = false;
  };
  const endSegment = () => {
    endWord();
    if (seg.length) out.push(seg);
    seg = [];
    target = null;
  };
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    const next = command[i + 1];
    if (quote) {
      if (c === quote) quote = null;
      else if (quote === '"' && c === esc && (next === '"' || next === esc)) word += command[++i];
      else word += c;
    } else if (c === "'" || c === '"') {
      quote = c;
      inWord = true;
    } else if (c === esc) {
      if (next === '\r' && command[i + 2] === '\n') i += 2;
      else if (next === '\n') i++;
      else if (next !== undefined) {
        word += command[++i];
        inWord = true;
      }
    } else if (c === '\n') {
      endSegment();
      for (const d of delims.splice(0)) i = heredocEnd(command, i + 1, d);
    } else if (c === ';' || c === '|' || (c === '&' && next === '&')) {
      endSegment();
      if (c === '&') i++;
    } else if (c === '<' || c === '>') {
      if (/^[\d&*]*$/.test(word)) {
        word = '';
        inWord = false;
      }
      endWord();
      if (command.startsWith('<<', i) && !command.startsWith('<<<', i)) {
        i += command[i + 2] === '-' ? 2 : 1;
        target = 'heredoc';
        continue;
      }
      while ('<>'.includes(command[i + 1] ?? ' ')) i++;
      if (command[i + 1] === '&' || command[i + 1] === '|') i++;
      const fd = /^[\d-]+/.exec(command.slice(i + 1));
      if (command[i] === '&' && fd) i += fd[0].length;
      else target = 'redirect';
    } else if (c === ' ' || c === '\t' || c === '\r') {
      endWord();
    } else {
      word += c;
      inWord = true;
    }
  }
  endSegment();
  return out;
}

const FILTER = /^(--include|-t$|--testNamePattern|--filter)/;

function segmentReason(words, shell) {
  let k = 0;
  while (/^\w+=/.test(words[k] ?? '')) k++;
  const t = words.slice(k);
  const x = t[0] === 'npx' ? 1 : 0;
  if (t[0] === 'dotnet' && t[1] === 'test') {
    if (!t.some((w) => /^--(filter|list-tests)\b/.test(w))) return 'dotnet test without --filter runs the whole suite';
  } else if (t[x] === 'ng' && t[x + 1] === 'test') {
    if (!t.some((w) => /^--include\b/.test(w))) return 'ng test without --include runs the whole suite';
  } else if (t[x] === 'vitest') {
    const args = t.slice(x + 1);
    const hasFile = args.some((a) => a !== 'run' && a !== 'watch' && !a.startsWith('-'));
    if (!hasFile && !args.some((a) => a === '-t' || a.startsWith('--testNamePattern'))) return 'vitest without a file or -t filter runs the whole suite';
  } else if (['npm', 'pnpm', 'yarn'].includes(t[0])) {
    const s = t[1] === 'run' ? 2 : 1;
    if (t[s] !== 'test') return null;
    if (shell === 'powershell' && t[0] === 'npm') return 'PowerShell drops the "--" before npm script arguments, so the filter never arrives; use npx ng test --include=... or run it in Bash';
    const rest = t.slice(s + 1);
    const after = t[0] !== 'npm' ? rest : rest.includes('--') ? rest.slice(rest.indexOf('--') + 1) : [];
    if (!after.some((a) => !a.startsWith('-') || FILTER.test(a))) return `${t[0]} test without a test filter runs the whole suite`;
  }
  return null;
}

export function unscopedTestReason(command, shell) {
  for (const words of segments(command, shell)) {
    const reason = segmentReason(words, shell);
    if (reason) return reason;
  }
  return null;
}

export function testGuardEnabled(cfg) {
  return cfg.testGuard !== false;
}
