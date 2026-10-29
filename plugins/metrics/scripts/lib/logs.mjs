import fs from 'node:fs';
import path from 'node:path';

function* jsonlFiles(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* jsonlFiles(p);
    else if (e.name.endsWith('.jsonl')) yield p;
  }
}

export function sumTokens(projectsDir, branch, untilIso) {
  const out = { input: 0, cacheRead: 0, output: 0, total: 0, sessions: 0, subagents: 0, first: null };
  let firstMs = Infinity;
  const until = Date.parse(untilIso);
  const needle = `"gitBranch":${JSON.stringify(branch)}`;
  const seen = new Set();
  for (const file of jsonlFiles(projectsDir)) {
    let text;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    if (!text.includes(needle)) continue;
    let counted = false;
    for (const l of text.split('\n')) {
      if (!l.includes(needle)) continue;
      let o;
      try {
        o = JSON.parse(l);
      } catch {
        continue;
      }
      const u = o?.message?.usage;
      if (o.type !== 'assistant' || o.gitBranch !== branch || !u || !(Date.parse(o.timestamp) <= until)) continue;
      const id = o.message.id ?? o.requestId;
      if (id) {
        if (seen.has(id)) continue;
        seen.add(id);
      }
      const ts = Date.parse(o.timestamp);
      if (ts < firstMs) (firstMs = ts, out.first = o.timestamp);
      out.input += (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
      out.cacheRead += u.cache_read_input_tokens ?? 0;
      out.output += u.output_tokens ?? 0;
      counted = true;
    }
    if (counted) path.basename(path.dirname(file)) === 'subagents' ? out.subagents++ : out.sessions++;
  }
  out.total = out.input + out.cacheRead + out.output;
  return out;
}
