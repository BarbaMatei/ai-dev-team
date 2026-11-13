import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { loadLocalConfig, projectRoot } from './lib/project.mjs';

const KEYS = ['accounts', 'dataQuery', 'logs', 'apiCopy', 'mail', 'callers'];
const PLACEHOLDER = { dataQuery: '{sql}', apiCopy: '{port}', callers: '{symbol}' };
const ENGINES = ['docker', 'podman'];
const MISSING = {
  tests: 'ask the owner for the scoped test command; never run the whole suite',
  app: "browser.baseUrl is not set: ask the owner for the app's address; browser:drive cannot run",
  start: 'ask the owner how they start the app',
  containers: 'build and deploy bugs are checked by reading the files only: mark them not verified',
  services: "outside services and test databases are not checked: ask the owner which ones the batch's flows need",
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
    if (key === 'services') {
      if (!isObject(value) || !Object.values(value).every(isText)) bad('fix.services must map names to check commands');
      continue;
    }
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

function onPath(engine) {
  const exts = process.platform === 'win32' ? ['', ...(process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';')] : [''];
  const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  return dirs.some((dir) =>
    exts.some((ext) => {
      try {
        return fs.statSync(path.join(dir, engine + ext)).isFile();
      } catch {
        return false;
      }
    }),
  );
}

function containers() {
  const engine = ENGINES.find(onPath);
  if (!engine) return null;
  const answers = spawnSync(`${engine} info`, { shell: true, timeout: 15000, encoding: 'utf8' }).status === 0;
  return answers
    ? [`${engine} (answers)`]
    : [`${engine} (installed, not answering)`, 'start it (or ask the owner to) before checking build or deploy bugs'];
}

function firstLine(r) {
  if (r.error) return 'no answer after 20 s';
  const text = `${r.stdout || ''}\n${r.stderr || ''}`;
  return (text.split(/\r?\n/).find((l) => l.trim() !== '') || '').trim().slice(0, 120);
}

function services(map, root) {
  const results = Object.entries(map).map(([name, cmd]) => {
    const r = spawnSync(cmd, { shell: true, timeout: 20000, encoding: 'utf8', cwd: root });
    return r.status === 0 ? `${name} ok` : `${name} not ready: ${firstLine(r)}`;
  });
  const line = results.join('; ');
  return results.some((s) => !s.endsWith(' ok'))
    ? [line, 'say in the batch opening what a re-check cannot show until it is ready']
    : [line];
}

function main() {
  let cfg;
  const root = projectRoot(process.cwd());
  try {
    cfg = loadLocalConfig(root);
  } catch (e) {
    fail(e.message.split(/\r?\n/)[0]);
  }
  const fix = readFix(cfg);
  const browser = isObject(cfg.browser) ? cfg.browser : {};
  const kinds = isObject(cfg.tests) ? Object.keys(cfg.tests).join(',') : '';
  const found = {
    tests: [kinds],
    app: [isText(browser.baseUrl) ? browser.baseUrl : ''],
    start: [startCommands(browser)],
    containers: containers() || [''],
    services: fix.services && Object.keys(fix.services).length ? services(fix.services, root) : [''],
  };
  for (const key of KEYS) found[key] = [fix[key] || ''];
  const out = [];
  for (const key of ['tests', 'app', 'start', 'containers', 'services', ...KEYS]) {
    const [value, hint] = found[key];
    if (value) out.push(hint ? [key, value, hint] : [key, value]);
    else if (key === 'callers') out.push([key, 'default', "the LSP tool's call hierarchy, then Grep"]);
    else out.push([key, 'missing', MISSING[key]]);
  }
  process.stdout.write(out.map((cols) => cols.map((c) => c.replace(/[\t\r\n]/g, ' ')).join('\t')).join('\n') + '\n');
}

main();
