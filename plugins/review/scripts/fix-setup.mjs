import { loadConfig, projectRoot } from './lib/project.mjs';

const KEYS = ['accounts', 'dataQuery', 'logs', 'apiCopy', 'mail', 'callers'];
const PLACEHOLDER = { dataQuery: '{sql}', apiCopy: '{port}', callers: '{symbol}' };
const MISSING = {
  tests: 'ask the owner for the scoped test command; never run the whole suite',
  app: "browser.baseUrl is not set: ask the owner for the app's address; browser:drive cannot run",
  start: 'ask the owner how they start the app',
  accounts: 'ask the owner for a test account; never use a real one',
  dataQuery: 'ask the owner for the record instead',
  logs: 'start an own copy (fix.apiCopy) and read its log, else ask the owner for the line',
  apiCopy: 'ask the owner to copy the log line',
  mail: 'paths that send email are checked by tests only: say so before presenting the bug',
};

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isText = (v) => typeof v === 'string' && v !== '';

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}

function readFix(cfg) {
  if (cfg.fix === undefined) return {};
  const bad = (m) => fail(`.claude/ai-dev-team.json: ${m}`);
  if (!isObject(cfg.fix)) bad('fix must be an object');
  for (const [key, value] of Object.entries(cfg.fix)) {
    if (!KEYS.includes(key)) bad(`fix.${key} is not a known key`);
    if (!isText(value)) bad(`fix.${key} must be a non-empty string`);
    if (PLACEHOLDER[key] && !value.includes(PLACEHOLDER[key])) bad(`fix.${key} must contain ${PLACEHOLDER[key]}`);
  }
  return cfg.fix;
}

function startCommands(browser) {
  const boot = Array.isArray(browser.boot) ? browser.boot : [];
  return boot
    .filter((e) => isObject(e) && typeof e.command === 'string')
    .map((e) => `${e.name}: ${e.command}${isText(e.cwd) ? ` (cwd ${e.cwd})` : ''}`)
    .join(' | ');
}

function main() {
  let cfg;
  try {
    cfg = loadConfig(projectRoot(process.cwd()));
  } catch (e) {
    fail(e.message.split(/\r?\n/)[0]);
  }
  const fix = readFix(cfg);
  const browser = isObject(cfg.browser) ? cfg.browser : {};
  const kinds = isObject(cfg.tests) ? Object.keys(cfg.tests).join(',') : '';
  const start = startCommands(browser);
  const found = {
    tests: kinds,
    app: isText(browser.baseUrl) ? browser.baseUrl : '',
    start,
    ...fix,
  };
  const out = [];
  for (const key of ['tests', 'app', 'start', ...KEYS]) {
    const value = found[key];
    if (value) out.push([key, value]);
    else if (key === 'callers') out.push([key, 'default', "the LSP tool's call hierarchy, then Grep"]);
    else out.push([key, 'missing', MISSING[key]]);
  }
  process.stdout.write(out.map((cols) => cols.map((c) => c.replace(/[\t\r\n]/g, ' ')).join('\t')).join('\n') + '\n');
}

main();
