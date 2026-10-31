import { spawnSync } from 'node:child_process';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const win = process.platform === 'win32';

export function alive(pid) {
  try {
    process.kill(win ? pid : -pid, 0);
    return true;
  } catch {
    return false;
  }
}

// The supervisor is always node; a reused pid belonging to anything else must never be killed.
export function isNode(pid) {
  const r = win
    ? spawnSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8', windowsHide: true })
    : spawnSync('ps', ['-o', 'comm=', '-p', String(pid)], { encoding: 'utf8' });
  return /node/i.test(r.stdout ?? '');
}

export const ours = (pid) => alive(pid) && isNode(pid);

export async function killTree(pid) {
  if (win) {
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    return;
  }
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    return;
  }
  for (let i = 0; i < 20 && alive(pid); i++) await sleep(100);
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {}
}
