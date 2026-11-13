export function isCommentLine(line) {
  const t = line.trim();
  return t.startsWith('//') || t.startsWith('/*') || /\s\/\/(\s|$)/.test(line);
}

export function commentPart(line) {
  const t = line.trim();
  if (t.startsWith('//') || t.startsWith('/*')) return t;
  const m = /\s\/\/(\s|$)/.exec(line);
  return m ? line.slice(m.index).trim() : '';
}

export function newComments(removed, added) {
  const pool = removed.filter(isCommentLine);
  let used = 0;
  const out = [];
  added.forEach((line, i) => {
    if (!isCommentLine(line)) return;
    const pair = pool[used];
    if (pair === undefined) return out.push(i);
    used++;
    if (commentPart(line).length > commentPart(pair).length) out.push(i);
  });
  return out;
}
