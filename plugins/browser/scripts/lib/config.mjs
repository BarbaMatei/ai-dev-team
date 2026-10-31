import { loadConfig } from './project.mjs';

const bad = (msg) => new Error(`.claude/ai-dev-team.json: browser.${msg}`);
const isStr = (v) => typeof v === 'string' && v !== '';

export function loadBrowser(root) {
  const e = loadConfig(root).browser ?? {};
  if (e === null || typeof e !== 'object' || Array.isArray(e)) throw bad('must be an object');
  if (e.baseUrl !== undefined && !isStr(e.baseUrl)) throw bad('baseUrl must be a string');
  if (e.timeoutSec !== undefined && !(typeof e.timeoutSec === 'number' && e.timeoutSec > 0)) throw bad('timeoutSec must be a positive number');
  const b = e.exe;
  if (b !== undefined && !isStr(b) && !(Array.isArray(b) && b.length > 0 && b.every(isStr))) throw bad('exe must be a string or an array of strings');
  const boot = e.boot ?? [];
  if (!Array.isArray(boot)) throw bad('boot must be an array');
  const names = new Set();
  boot.forEach((x, i) => {
    if (x === null || typeof x !== 'object' || Array.isArray(x)) throw bad(`boot[${i}] must be an object`);
    if (!isStr(x.name)) throw bad(`boot[${i}].name must be a string`);
    if (!/^[\w.-]+$/.test(x.name)) throw bad(`boot[${i}].name may only use letters, digits, dot, dash and underscore`);
    if (names.has(x.name)) throw bad(`boot[${i}].name is a duplicate: ${x.name}`);
    names.add(x.name);
    if (!isStr(x.ready) || !/^(https?|tcp):\/\//.test(x.ready)) throw bad(`boot[${i}].ready must be an http(s):// or tcp:// address`);
    for (const k of ['command', 'cwd']) if (x[k] !== undefined && !isStr(x[k])) throw bad(`boot[${i}].${k} must be a string`);
    if (x.env !== undefined && (x.env === null || typeof x.env !== 'object' || Array.isArray(x.env))) throw bad(`boot[${i}].env must be an object`);
  });
  return { ...e, boot, timeoutSec: e.timeoutSec ?? 120 };
}
