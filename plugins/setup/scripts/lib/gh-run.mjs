import { spawnSync } from 'node:child_process';

const SAFE = /^[\w./:@=,+-]+$/;

export function quote(arg, platform = process.platform) {
  if (SAFE.test(arg)) return arg;
  if (/["%\r\n\0]/.test(arg)) throw new Error(`setup: cannot pass ${JSON.stringify(arg)} to gh`);
  return platform === 'win32' ? `"${arg}"` : `'${arg.replace(/'/g, "'\\''")}'`;
}

export class GhError extends Error {
  constructor(stderr) {
    super(stderr.trim().split('\n')[0] || 'no message');
    this.forbidden = stderr.includes('HTTP 403');
  }
}

export function commandLine(cmd, args, platform = process.platform) {
  return `${cmd} ${args.map((a) => quote(a, platform)).join(' ')}`;
}

export function makeGh(cmd, cwd) {
  return (args, input) => {
    const r = spawnSync(commandLine(cmd, args), { cwd, shell: true, input, encoding: 'utf8', maxBuffer: 64 << 20 });
    if (r.status !== 0) throw new GhError(r.stderr || String(r.error ?? ''));
    return r.stdout;
  };
}
