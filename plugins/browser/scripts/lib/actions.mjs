import fs from 'node:fs';
import path from 'node:path';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const KEY_INFO = {
  Enter: { vk: 13, text: '\r' },
  Tab: { vk: 9 },
  Escape: { vk: 27 },
  Space: { vk: 32, text: ' ', key: ' ' },
  Backspace: { vk: 8 },
  ArrowUp: { vk: 38 },
  ArrowDown: { vk: 40 },
};

async function evaluate(page, expression) {
  const r = await page.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text ?? 'evaluation failed');
  return r.result?.value;
}

async function poll(probe, ms, interval = 100) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await probe();
    if (v) return v;
    if (Date.now() >= end) return null;
    await sleep(Math.min(interval, Math.max(end - Date.now(), 1)));
  }
}

const finder = (sel, body) => `(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; ${body} })()`;
const SHOWN = 'const r = e.getBoundingClientRect(), s = getComputedStyle(e); if (!r.width || !r.height || s.visibility === "hidden" || s.display === "none") return null;';
const VISIBLE = (sel) => finder(sel, `${SHOWN} return true;`);
const FOCUS = (sel) => finder(sel, `${SHOWN} e.scrollIntoView({ block: "center", inline: "center" }); e.focus(); if (e.select) e.select(); else if (e.isContentEditable) { const g = getSelection(); g.selectAllChildren(e); } return true;`);
const LOCATE = (sel) =>
  finder(
    sel,
    `${SHOWN} e.scrollIntoView({ block: "center", inline: "center" }); const b = e.getBoundingClientRect(); const t = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2); const cover = t && t !== e && !e.contains(t) ? t.tagName.toLowerCase() + (t.id ? "#" + t.id : "") + (t.classList[0] ? "." + t.classList[0] : "") : null; return { x: b.x, y: b.y, width: b.width, height: b.height, cover };`,
  );

export async function screenshot(page, file) {
  const { data } = await page.send('Page.captureScreenshot', { format: 'png' });
  if (!data) throw new Error('empty screenshot');
  fs.writeFileSync(file, Buffer.from(data, 'base64'));
}

async function go(page, step) {
  const { net } = page;
  net.open.clear();
  net.skip.clear();
  const loaded = new Promise((res, rej) => {
    net.loaded = res;
    page.closed.then(() => rej(new Error('connection closed')));
  });
  loaded.catch(() => {});
  const nav = await page.send('Page.navigate', { url: step.url });
  if (nav.errorText) throw new Error(`navigation failed: ${nav.errorText}`);
  let timer;
  const timeout = new Promise((r) => (timer = setTimeout(r, step.timeoutMs, 'timeout')));
  const outcome = await Promise.race([loaded, timeout]);
  clearTimeout(timer);
  if (outcome === 'timeout') throw new Error(`no load event after ${step.timeoutMs} ms`);
  net.last = Date.now();
  const end = Date.now() + step.timeoutMs;
  while (Date.now() < end && !(net.open.size === 0 && Date.now() - net.last >= 500)) await sleep(50);
}

async function press(page, key) {
  const { vk, text, key: k = key } = KEY_INFO[key];
  const base = { key: k, code: key, windowsVirtualKeyCode: vk };
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', ...base, ...(text && { text }) });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
}

async function upload(page, step) {
  const found = await poll(async () => {
    const { root } = await page.send('DOM.getDocument', { depth: 0 });
    const { nodeId } = await page.send('DOM.querySelector', { nodeId: root.nodeId, selector: step.arg });
    return nodeId;
  }, step.timeoutMs);
  if (!found) throw new Error(`not found after ${step.timeoutMs} ms`);
  await page.send('DOM.setFileInputFiles', { files: step.files, nodeId: found });
}

export async function runStep(page, step, ctx) {
  const { arg } = step;
  const notFound = `not found after ${step.timeoutMs} ms`;
  if (step.action === 'go') return go(page, step);
  if (step.action === 'sleep') return sleep(arg);
  if (step.action === 'press') return press(page, arg);
  if (step.action === 'upload') return upload(page, step);
  if (step.action === 'shot') {
    const file = path.join(ctx.outDir, `${arg}.png`);
    await screenshot(page, file);
    return ctx.out(`shot ${file}`);
  }
  if (step.action === 'eval') {
    const json = JSON.stringify((await evaluate(page, arg)) ?? null);
    return ctx.out(`eval ${step.n} ${json.slice(0, 2000)}`);
  }
  if (step.action === 'until') {
    if (!(await poll(() => evaluate(page, arg), step.timeoutMs))) throw new Error(`still falsy after ${step.timeoutMs} ms`);
    return;
  }
  if (step.action === 'wait') {
    if (!(await poll(() => evaluate(page, VISIBLE(arg)), step.timeoutMs))) throw new Error(notFound);
    return;
  }
  if (step.action === 'type') {
    if (!(await poll(() => evaluate(page, FOCUS(arg)), step.timeoutMs))) throw new Error(notFound);
    return page.send('Input.insertText', { text: step.text });
  }
  const spot = await poll(() => evaluate(page, LOCATE(arg)), step.timeoutMs);
  if (!spot) throw new Error(notFound);
  if (spot.cover) ctx.out(`note ${step.n} click point covered by ${spot.cover}`);
  const at = { x: spot.x + spot.width / 2, y: spot.y + spot.height / 2, button: 'left', clickCount: 1 };
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...at });
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...at });
}
