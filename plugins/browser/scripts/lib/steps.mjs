import fs from 'node:fs';
import path from 'node:path';
import { parseFakes } from './fakes.mjs';

export const KEYS = ['Enter', 'Tab', 'Escape', 'Space', 'Backspace', 'ArrowUp', 'ArrowDown'];
const ACTIONS = ['go', 'wait', 'until', 'click', 'type', 'press', 'upload', 'eval', 'shot', 'sleep'];
const EXTRA = new Set(['text', 'files', 'timeoutMs']);
const TOP = ['viewport', 'timeoutMs', 'fake', 'steps'];
const bad = (msg) => Object.assign(new Error(msg), { code: 2 });
const isStr = (v) => typeof v === 'string' && v !== '';

function parseStep(raw, n, stepsDir, baseUrl, defaultTimeout, hint) {
  const err = (msg) => bad(`step ${n}: ${msg}`);
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw err('must be an object');
  const keys = Object.keys(raw).filter((k) => !EXTRA.has(k));
  if (keys.length === 0) throw err('no action');
  if (keys.length > 1) throw err(`more than one action (${keys.join(', ')})`);
  const action = keys[0];
  if (!ACTIONS.includes(action)) throw err(`unknown action "${action}"`);
  const arg = raw[action];
  if (raw.text !== undefined && action !== 'type') throw err('"text" is only for type');
  if (raw.files !== undefined && action !== 'upload') throw err('"files" is only for upload');
  const step = { n, action, arg, timeoutMs: raw.timeoutMs ?? defaultTimeout };
  if (!(typeof step.timeoutMs === 'number' && step.timeoutMs > 0)) throw err('timeoutMs must be a positive number');
  if (action === 'sleep') {
    if (!(typeof arg === 'number' && arg >= 0)) throw err('sleep must be a number of milliseconds');
    return step;
  }
  if (!isStr(arg)) throw err(`${action} must be a non-empty string`);
  if (action === 'press' && !KEYS.includes(arg)) throw err(`press must be one of ${KEYS.join(', ')}`);
  if (action === 'shot' && !/^[\w.-]+$/.test(arg)) throw err('shot name may only use letters, digits, dot, dash and underscore');
  if (action === 'type') {
    if (typeof raw.text !== 'string') throw err('type needs a "text" string');
    step.text = raw.text;
  }
  if (action === 'go') {
    if (/^https?:\/\//.test(arg)) step.url = arg;
    else if (!baseUrl) throw err(`go "${arg}" needs browser.baseUrl in .claude/ai-dev-team.json${hint}`);
    else step.url = baseUrl.replace(/\/+$/, '') + (arg.startsWith('/') ? '' : '/') + arg;
  }
  if (action === 'upload') {
    if (!Array.isArray(raw.files) || raw.files.length === 0 || !raw.files.every(isStr)) throw err('upload needs a "files" list of paths');
    step.files = raw.files.map((f) => path.resolve(stepsDir, f));
    const missing = step.files.find((f) => !fs.existsSync(f));
    if (missing) throw err(`upload file not found: ${missing}`);
  }
  return step;
}

export function parseSteps(text, stepsDir, baseUrl, hint = '') {
  let doc;
  try {
    doc = JSON.parse(text);
  } catch (e) {
    throw bad(`steps file is not valid JSON: ${e.message}`);
  }
  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) throw bad('steps file must be a JSON object');
  const unknown = Object.keys(doc).find((k) => !TOP.includes(k));
  if (unknown) throw bad(`steps file: unknown key "${unknown}"`);
  const size = /^(\d+)x(\d+)$/.exec(doc.viewport ?? '1280x800');
  if (!size) throw bad('viewport must look like 1280x800');
  const timeoutMs = doc.timeoutMs ?? 10000;
  if (!(typeof timeoutMs === 'number' && timeoutMs > 0)) throw bad('timeoutMs must be a positive number');
  if (!Array.isArray(doc.steps) || doc.steps.length === 0) throw bad('steps must be a non-empty list');
  return {
    viewport: [Number(size[1]), Number(size[2])],
    timeoutMs,
    fake: parseFakes(doc.fake ?? [], stepsDir),
    steps: doc.steps.map((s, i) => parseStep(s, i + 1, stepsDir, baseUrl, timeoutMs, hint)),
  };
}
