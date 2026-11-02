import { spawnSync } from 'node:child_process';

const SAFE = /^[\w./:@=,+-]+$/;

export function quote(arg) {
  if (SAFE.test(arg)) return arg;
  if (/["%\r\n\0]/.test(arg)) throw new Error(`setup: cannot pass ${JSON.stringify(arg)} to gh`);
  return process.platform === 'win32' ? `"${arg}"` : `'${arg.replace(/'/g, "'\''")}'`;
}

export class GhError extends Error {
  constructor(stderr) {
    super(stderr.trim().split('\n')[0] || 'no message');
    this.forbidden = stderr.includes('HTTP 403');
  }
}

export function makeGh(cmd, cwd) {
  return (args, input) => {
    const r = spawnSync(`${cmd} ${args.map(quote).join(' ')}`, { cwd, shell: true, input, encoding: 'utf8', maxBuffer: 64 << 20 });
    if (r.status !== 0) throw new GhError(r.stderr || String(r.error ?? ''));
    return r.stdout;
  };
}
