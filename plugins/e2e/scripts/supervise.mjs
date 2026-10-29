import { spawn } from 'node:child_process';
import fs from 'node:fs';

// Windows loses a detached cmd child's output, so this detached node runs the command with the log as its stdio.
const [log, command, cwd] = process.argv.slice(2);
const fd = fs.openSync(log, 'w');
const child = spawn(command, { shell: true, windowsHide: true, cwd, stdio: ['ignore', fd, fd] });
child.on('exit', (code) => process.exit(code ?? 1));
