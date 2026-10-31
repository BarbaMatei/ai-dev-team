import fs from 'node:fs';

const SECTIONS = ['Breaking changes', 'Features', 'Fixes', 'Other changes'];

function sectionOf(c) {
  if (c.breaking) return 'Breaking changes';
  if (c.type === 'feat') return 'Features';
  return c.type === 'fix' || c.type === 'perf' ? 'Fixes' : 'Other changes';
}

export function sectionBody(commits, env = process.env) {
  if (commits === null) return 'First release.\n';
  const link = (sha) => {
    const short = sha.slice(0, 7);
    return env.GITHUB_SERVER_URL && env.GITHUB_REPOSITORY ? `[${short}](${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/commit/${sha})` : short;
  };
  return SECTIONS.map((title) => ({ title, items: commits.filter((c) => sectionOf(c) === title) }))
    .filter((s) => s.items.length)
    .map((s) => `### ${s.title}\n\n${s.items.map((c) => `- ${c.text} (${link(c.sha)})`).join('\n')}\n`)
    .join('\n');
}

export function prependSection(file, version, date, body) {
  const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const eol = existing.includes('\r\n') ? '\r\n' : '\n';
  const section = `## ${version} (${date})\n\n${body}`.replace(/\n/g, eol);
  const heading = /^# [^\r\n]*(\r?\n)?/.exec(existing);
  const head = heading ? heading[0].replace(/\r?\n$/, '') : '# Changelog';
  const rest = existing.slice(heading ? heading[0].length : 0).replace(/^(\r?\n)+/, '');
  fs.writeFileSync(file, `${head}${eol}${eol}${section}${rest ? eol + rest : ''}`);
}

function topLevelVersion(text) {
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') depth--;
    else if (c === '"') {
      let j = i + 1;
      while (text[j] !== '"' && j < text.length) j += text[j] === '\\' ? 2 : 1;
      const key = text.slice(i + 1, j);
      const colon = /^\s*:\s*/.exec(text.slice(j + 1));
      if (depth === 1 && colon && key === 'version') {
        const start = j + 1 + colon[0].length;
        const value = /^"([^"\\]*)"/.exec(text.slice(start));
        return value ? { start: start + 1, end: start + 1 + value[1].length, value: value[1] } : null;
      }
      i = j;
    }
  }
  return null;
}

export function readVersion(text) {
  return topLevelVersion(text)?.value ?? null;
}

export function replaceVersion(text, version) {
  const hit = topLevelVersion(text);
  return `${text.slice(0, hit.start)}${version}${text.slice(hit.end)}`;
}
