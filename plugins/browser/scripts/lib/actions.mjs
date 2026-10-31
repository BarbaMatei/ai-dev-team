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

export function within(promise, dl, message) {
  let timer;
  const timeout = new Promise((_, rej) => (timer = setTimeout(() => rej(Object.assign(new Error(message), { soft: true, timeout: true })), Math.max(dl.at - Date.now(), 1))));
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function evaluate(page, expression, dl) {
  const r = await page.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw Object.assign(new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text ?? 'evaluation failed'), { soft: true });
  return r.result?.value;
}

async function poll(dl, message, probe, interval = 100) {
  let last;
  for (;;) {
    try {
      const v = await probe();
      if (v) return v;
    } catch (e) {
      if (!e.soft) throw e;
      if (!e.timeout) last = e;
    }
    if (Date.now() >= dl.at) throw new Error(last ? `${message}: ${clip(last.message)}` : message);
    await sleep(Math.min(interval, Math.max(dl.at - Date.now(), 1)));
  }
}

const clip = (m) => m.replace(/\s+/g, ' ').slice(0, 200);
const clock = (step) => ({ at: Date.now() + step.timeoutMs, ms: step.timeoutMs });

const finder = (sel, body) => `(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; ${body} })()`;
const SHOWN = 'const r = e.getBoundingClientRect(), s = getComputedStyle(e); if (!r.width || !r.height || s.visibility === "hidden" || s.display === "none") return null;';
const VISIBLE = (sel) => finder(sel, `${SHOWN} return true;`);
const FOCUS = (sel) => finder(sel, `${SHOWN} e.scrollIntoView({ block: "center", inline: "center", behavior: "instant" }); e.focus(); if (e.select) e.select(); else if (e.isContentEditable) { const g = getSelection(); g.selectAllChildren(e); } return true;`);
export const LOCATE = (sel) =>
  finder(
    sel,
    `${SHOWN} e.scrollIntoView({ block: "center", inline: "center", behavior: "instant" }); const b = e.getBoundingClientRect(); const t = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2); if (!t) return null; const cover = t !== e && !e.contains(t) ? t.tagName.toLowerCase() + (t.id ? "#" + t.id : "") + (t.classList[0] ? "." + t.classList[0] : "") : null; return { x: b.x, y: b.y, width: b.width, height: b.height, cover };`,
  );

export async function screenshot(page, file) {
  const { data } = await page.send('Page.captureScreenshot', { format: 'png' });
  if (!data) throw new Error('empty screenshot');
  fs.writeFileSync(file, Buffer.from(data, 'base64'));
}

async function go(page, step, dl) {
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
  if (nav.loaderId) await within(loaded, dl, `no load event after ${dl.ms} ms`);
  net.last = Date.now();
  while (Date.now() < dl.at && !(net.open.size === 0 && Date.now() - net.last >= 500)) await sleep(50);
}

async function press(page, key) {
  const { vk, text, key: k = key } = KEY_INFO[key];
  const base = { key: k, code: key, windowsVirtualKeyCode: vk };
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', ...base, ...(text && { text }) });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
}

async function upload(page, step, dl) {
  const found = await poll(dl, `not found after ${step.timeoutMs} ms`, async () => {
    const { root } = await page.send('DOM.getDocument', { depth: 0 });
    const { nodeId } = await page.send('DOM.querySelector', { nodeId: root.nodeId, selector: step.arg });
    return nodeId;
  });
  await page.send('DOM.setFileInputFiles', { files: step.files, nodeId: found });
}

const TIMED_OUT = { 'Runtime.evaluate': (ms) => `evaluation timed out after ${ms} ms`, 'Page.navigate': (ms) => `navigation timed out after ${ms} ms` };

export async function runStep(raw, step, ctx) {
  const { arg } = step;
  const dl = clock(step);
  const page = { ...raw, send: (m, p) => within(raw.send(m, p), dl, (TIMED_OUT[m] ?? ((ms) => `${m} timed out after ${ms} ms`))(dl.ms)) };
  const notFound = `not found after ${step.timeoutMs} ms`;
  if (step.action === 'go') return go(page, step, dl);
  if (step.action === 'sleep') return sleep(arg);
  if (step.action === 'press') return press(page, arg);
  if (step.action === 'upload') return upload(page, step, dl);
  if (step.action === 'shot') {
    const file = path.join(ctx.outDir, `${arg}.png`);
    await screenshot(page, file);
    return ctx.out(`shot ${file}`);
  }
  if (step.action === 'eval') {
    const json = JSON.stringify((await evaluate(page, arg, dl)) ?? null);
    return ctx.out(`eval ${step.n} ${json.slice(0, 2000)}`);
  }
  if (step.action === 'until') return void (await poll(dl, `still falsy after ${step.timeoutMs} ms`, () => evaluate(page, arg, dl)));
  if (step.action === 'wait') return void (await poll(dl, notFound, () => evaluate(page, VISIBLE(arg), dl)));
  if (step.action === 'type') {
    await poll(dl, notFound, () => evaluate(page, FOCUS(arg), dl));
    return page.send('Input.insertText', { text: step.text });
  }
  const spot = await poll(dl, notFound, () => evaluate(page, LOCATE(arg), dl));
  if (spot.cover) ctx.out(`note ${step.n} click point covered by ${spot.cover}`);
  const at = { x: spot.x + spot.width / 2, y: spot.y + spot.height / 2, button: 'left', clickCount: 1 };
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...at });
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...at });
}
