import { spawnSync } from 'node:child_process';

export class Stop extends Error {
  constructor(code, msg) {
    super(msg);
    this.code = code;
  }
}

export function splitCommand(cmd) {
  return [...cmd.matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2]);
}

export function runGh(cmd, args, cwd, timeoutMs) {
  if (timeoutMs !== undefined && timeoutMs <= 0) throw new Stop(1, 'metrics: deadline reached');
  const [exe, ...pre] = splitCommand(cmd);
  const r = spawnSync(exe, [...pre, ...args], { cwd, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 64 << 20 });
  if (r.status !== 0) throw new Stop(1, `metrics: ${cmd} ${args.slice(0, 2).join(' ')} failed${r.stderr ? `: ${r.stderr.trim()}` : ''}`);
  try {
    return JSON.parse(r.stdout);
  } catch {
    throw new Stop(1, `metrics: ${cmd} ${args.slice(0, 2).join(' ')} returned invalid JSON`);
  }
}
