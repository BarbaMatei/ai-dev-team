import path from 'node:path';

// Bracket-balanced end: an added helper between tests is not part of the test above.
export function bodyEnd(lines, decl, limit, file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.py') {
    let end = decl.line;
    for (let l = decl.line + 1; l <= limit; l++) {
      if (lines[l - 1].trim() === '') continue;
      if (!/^\s/.test(lines[l - 1])) break;
      end = l;
    }
    return end;
  }
  const js = !['.cs', '.java', '.kt', '.go'].includes(ext);
  let depth = 0;
  let opened = false;
  let quote = null;
  let block = false;
  for (let l = decl.line; l <= limit; l++) {
    const s = lines[l - 1];
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (block) {
        if (c === '*' && s[i + 1] === '/') (block = false, i++);
      } else if (quote) {
        if (c === '\\') i++;
        else if (c === quote) quote = null;
      } else if (c === '/' && s[i + 1] === '/') break;
      else if (c === '/' && s[i + 1] === '*') (block = true, i++);
      else if (c === "'" || c === '"' || c === '`') quote = c;
      else if (c === '{' || (js && c === '(')) (depth++, (opened = true));
      else if (c === '}' || (js && c === ')')) depth--;
    }
    if (quote && quote !== '`') quote = null;
    if (opened && !quote && !block && depth <= 0) return l;
  }
  return limit;
}
