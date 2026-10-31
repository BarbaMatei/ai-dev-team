#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fail, findBrowser, launch, openPage } from './lib/browser.mjs';
import { runStep, screenshot, within } from './lib/actions.mjs';
import { bodyOf, fulfil, matchFake } from './lib/fakes.mjs';
import { loadBrowser } from './lib/config.mjs';
import { projectRoot } from './lib/project.mjs';
import { parseSteps } from './lib/steps.mjs';

const LINES_ON_STDOUT = 50;
const SHOT_CAP_MS = 5000;
const clip = (s, max) => String(s).replace(/\s+/g, ' ').trim().slice(0, max);
const argText = (arg) => clip(arg, 80);

const argValue = (a) => a.value ?? a.description ?? a.type;
const isNoisy = (level) => level === 'error' || level === 'warning';

function watch(cdp, emit) {
  const reqs = new Map();
  const stats = { api: 0, faked: 0, noisy: 0 };
  const say = (line) => emit(line, ++stats.noisy > LINES_ON_STDOUT && 'console');
  cdp.on((method, p) => {
    if (method === 'Runtime.consoleAPICalled') {
      if (isNoisy(p.type)) say(`console ${p.type} ${clip(p.args.map(argValue).join(' '), 300)}`);
    } else if (method === 'Log.entryAdded') {
      if (isNoisy(p.entry.level)) say(`console ${p.entry.level} ${clip(p.entry.text, 300)}${p.entry.url ? ` ${p.entry.url}` : ''}`);
    } else if (method === 'Runtime.exceptionThrown') {
      const d = p.exceptionDetails;
      say(`exception ${clip(d.exception?.description ?? d.text, 300)}`);
    } else if (method === 'Network.requestWillBeSent') {
      reqs.set(p.requestId, { method: p.request.method, url: p.request.url });
    } else if (method === 'Network.loadingFinished') {
      reqs.delete(p.requestId);
    } else if (method === 'Network.responseReceived' && (p.type === 'XHR' || p.type === 'Fetch')) {
      stats.api++;
      emit(`api ${p.response.status} ${reqs.get(p.requestId)?.method ?? 'GET'} ${p.response.url}`, stats.api > LINES_ON_STDOUT && 'api');
    } else if (method === 'Network.loadingFailed') {
      const r = reqs.get(p.requestId);
      say(`failed ${r?.method ?? 'GET'} ${r?.url ?? p.requestId} ${p.errorText}`);
      reqs.delete(p.requestId);
    }
  });
  return stats;
}

async function main() {
  let session;
  try {
    const [stepsArg, outArg, ...extra] = process.argv.slice(2);
    if (!stepsArg || !outArg || extra.length) throw fail('usage: drive.mjs <steps.json> <out-dir>', 2);
    const stepsFile = path.resolve(stepsArg);
    let text;
    try {
      text = fs.readFileSync(stepsFile, 'utf8');
    } catch {
      throw fail(`steps file not found: ${stepsFile}`, 2);
    }
    const cfg = loadBrowser(projectRoot(process.cwd()));
    const plan = parseSteps(text, path.dirname(stepsFile), cfg.baseUrl, cfg.moved);
    const browser = findBrowser(cfg);
    const outDir = path.resolve(outArg);
    fs.mkdirSync(outDir, { recursive: true });
    const logFile = path.join(outDir, 'drive.log');
    fs.writeFileSync(logFile, '');
    const hidden = { api: 0, console: 0 };
    const emit = (line, quiet = false) => {
      fs.appendFileSync(logFile, `${line}\n`);
      if (quiet) hidden[quiet]++;
      else process.stdout.write(`${line}\n`);
    };
    const ctx = { outDir, out: emit };

    const starting = launch(browser);
    for (const [sig, code] of [['SIGINT', 130], ['SIGTERM', 143]]) {
      process.on(sig, () => starting.then((s) => s.shutdown(), () => {}).finally(() => process.exit(code)));
    }
    session = await starting;
    const stats = watch(session.cdp, emit);
    const page = await openPage(session.cdp);
    const [w, h] = plan.viewport;
    await page.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 768 });
    await page.send('Runtime.enable');
    await page.send('Log.enable');
    session.cdp.on((method, p, sid) => {
      if (method !== 'Page.javascriptDialogOpening' || sid !== page.sessionId) return;
      emit(`dialog ${p.type} ${clip(p.message, 300)}`);
      page.send('Page.handleJavaScriptDialog', { accept: true }).catch(() => {});
    });
    if (plan.fake.length) {
      session.cdp.on(async (method, p) => {
        if (method !== 'Fetch.requestPaused') return;
        const { requestId, request } = p;
        try {
          const fake = matchFake(plan.fake, request.url, request.method);
          if (!fake) return await page.send('Fetch.continueRequest', { requestId }).catch(() => {});
          await page.send('Fetch.fulfillRequest', { requestId, ...fulfil(request, fake, bodyOf(fake)) });
          stats.faked++;
          emit(`fake ${request.method} ${request.url}`);
        } catch (e) {
          emit(`fake-error ${request.method} ${request.url}: ${clip(e.message, 300)}`);
          await page.send('Fetch.failRequest', { requestId, errorReason: 'Failed' }).catch(() => {});
        }
      });
      await page.send('Fetch.enable', { patterns: plan.fake.map((f) => ({ urlPattern: f.url, requestStage: 'Request' })) });
    }

    let done = 0;
    for (const step of plan.steps) {
      emit(`step ${step.n} ${step.action} ${argText(step.arg)}`);
      try {
        await runStep(page, step, ctx);
        done++;
      } catch (e) {
        emit(`fail ${step.n} ${step.action} ${argText(step.arg)}: ${clip(e.message, 300)}`);
        const cap = { at: Date.now() + SHOT_CAP_MS, ms: SHOT_CAP_MS };
        await within(screenshot(page, path.join(outDir, `fail-${step.n}.png`)), cap, 'screenshot timed out').catch(() => {});
        process.exitCode = 1;
        break;
      }
    }
    for (const k of ['api', 'console']) if (hidden[k]) process.stdout.write(`${k} … ${hidden[k]} more in drive.log\n`);
    if (process.exitCode !== 1) emit(`done ${done} steps, ${stats.api} api requests, ${stats.faked} faked, log ${logFile}`);
  } catch (e) {
    process.exitCode = session ? 1 : typeof e.code === 'number' ? e.code : 2;
    process.stderr.write(`${e.message}\n`);
  } finally {
    if (session) await session.shutdown();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
