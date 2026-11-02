const OPEN = /^<!-- kit:([\w-]+) -->$/;
const eolOf = (text) => (text.includes('\r\n') ? '\r\n' : '\n');
const split = (text) => text.split(/\r?\n/);

function locate(lines) {
  const found = [];
  for (let i = 0; i < lines.length; i++) {
    const m = OPEN.exec(lines[i]);
    if (!m) continue;
    const close = lines.indexOf(`<!-- /kit:${m[1]} -->`, i + 1);
    if (close !== -1) found.push({ id: m[1], start: i + 1, end: close });
  }
  return found;
}

export function readBlocks(text) {
  const lines = split(text);
  return new Map(locate(lines).map((b) => [b.id, lines.slice(b.start, b.end).join('\n')]));
}

export function replaceBlock(text, id, body) {
  const lines = split(text);
  const b = locate(lines).find((x) => x.id === id);
  if (!b) return text;
  lines.splice(b.start, b.end - b.start, ...(body === '' ? [] : split(body)));
  return lines.join(eolOf(text));
}
