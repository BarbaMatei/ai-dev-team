export function parseCsv(text) {
  const recs = [];
  let rec = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') cur += text[++i];
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') (rec.push(cur), (cur = ''));
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      rec.push(cur);
      cur = '';
      if (rec.some((x) => x !== '')) recs.push(rec);
      rec = [];
    } else cur += c;
  }
  if (cur !== '' || rec.length) recs.push([...rec, cur]);
  const [head = [], ...rest] = recs;
  return rest.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}
