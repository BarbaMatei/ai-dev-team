import fs from 'node:fs';

const argv = process.argv.slice(2);
let stdin = '';
try {
  stdin = fs.readFileSync(0, 'utf8');
} catch {}
fs.appendFileSync(process.env.FAKE_GH_LOG, `${JSON.stringify({ argv, stdin })}\n`);
const script = JSON.parse(fs.readFileSync(process.env.FAKE_GH_SCRIPT, 'utf8'));
const hit = script.find((s) => s.match.every((m, i) => argv[i] === m));
if (!hit) {
  process.stderr.write(`fake-gh: unscripted call ${argv.join(' ')}\n`);
  process.exit(99);
}
process.stdout.write(hit.stdout ?? '');
process.stderr.write(hit.stderr ?? '');
process.exit(hit.code ?? 0);
