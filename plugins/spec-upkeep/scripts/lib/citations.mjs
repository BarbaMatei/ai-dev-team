export const COMMANDS = new Set('dotnet npm npx node git gh claude python python3 pip docker make sh bash pwsh go cargo mvn gradle'.split(' '));
export const EXT = /\.(md|cs|csproj|sln|ts|tsx|js|mjs|cjs|json|yml|yaml|toml|scss|css|html|ps1|sh|py|go|rs|java|kt|sql|xml|txt)$/i;
const SHELL_LANGS = new Set(['', 'sh', 'bash', 'shell', 'console', 'powershell', 'ps1', 'pwsh']);

export const stripLine = (s) => s.replace(/:\d+(?:-\d+)?$/, '');

export function classify(span) {
  const s = span.trim();
  if (!s || /[<>{}$]|\.\.\.|…/.test(s) || /^(\/|http|-)/.test(s)) return null;
  if (COMMANDS.has(s.split(/\s+/)[0]) && /\s/.test(s)) return 'command';
  if (/\s/.test(s)) return null;
  const p = stripLine(s);
  if (/[A-Za-z]/.test(p) && (p.includes('/') || /^\.{1,2}\/|^\.[A-Za-z_]/.test(p) || EXT.test(p))) return 'path';
  if (!/^[A-Za-z_]\w*(\.[A-Za-z_]\w*)*(\(\))?$/.test(s)) return null;
  return /\./.test(s) || /[a-z][A-Z]|[A-Z][a-z]+[A-Z]/.test(s) || /[A-Za-z]_[A-Za-z]/.test(s) ? 'symbol' : null;
}

export function extractCitations(text) {
  const out = [];
  let fence = null;
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = i + 1;
    const f = /^\s*(`{3,}|~{3,})\s*(\S*)/.exec(raw);
    if (f) {
      fence = fence ? null : { lang: f[2].toLowerCase() };
      return;
    }
    if (fence) {
      if (!SHELL_LANGS.has(fence.lang)) return;
      const cmd = raw.trim().replace(/^[$>]\s+/, '');
      if (classify(cmd) === 'command') out.push({ line, kind: 'command', text: cmd });
      return;
    }
    for (const m of raw.matchAll(/`([^`]+)`/g)) {
      const kind = classify(m[1]);
      if (kind) out.push({ line, kind, text: m[1].trim() });
    }
    for (const m of raw.matchAll(/\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
      const t = m[1];
      if (!/^(https?:|mailto:|#)/i.test(t) && !/[<>{}$]/.test(t)) out.push({ line, kind: 'link', text: t });
    }
  });
  return out;
}
