import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const udd = process.argv.find((a) => a.startsWith('--user-data-dir='))?.slice('--user-data-dir='.length);
const log = process.env.FAKE_CDP_LOG;
const mode = process.env.FAKE_CDP_MODE ?? '';
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
if (log) fs.writeFileSync(`${log}.pid`, String(process.pid));
if (log) fs.writeFileSync(`${log}.udd`, udd ?? '');
const script = process.env.FAKE_CDP_SCRIPT ? JSON.parse(fs.readFileSync(process.env.FAKE_CDP_SCRIPT, 'utf8')) : {};
const used = {};

if (mode === 'nostart') setInterval(() => {}, 1000);
else {
  const frame = (obj) => {
    const p = Buffer.from(JSON.stringify(obj));
    let head;
    if (p.length < 126) head = Buffer.from([0x81, p.length]);
    else if (p.length < 65536) head = Buffer.from([0x81, 126, p.length >> 8, p.length & 255]);
    else {
      head = Buffer.alloc(10);
      head[0] = 0x81;
      head[1] = 127;
      head.writeBigUInt64BE(BigInt(p.length), 2);
    }
    return Buffer.concat([head, p]);
  };

  function parse(buf) {
    const out = [];
    let o = 0;
    while (buf.length - o >= 2) {
      const op = buf[o] & 15;
      let len = buf[o + 1] & 127;
      let h = 2;
      if (len === 126) [len, h] = [buf.readUInt16BE(o + 2), 4];
      else if (len === 127) [len, h] = [Number(buf.readBigUInt64BE(o + 2)), 10];
      const masked = (buf[o + 1] & 128) !== 0;
      if (buf.length - o < h + (masked ? 4 : 0) + len) break;
      const mask = masked ? buf.subarray(o + h, o + h + 4) : null;
      const start = o + h + (masked ? 4 : 0);
      const data = Buffer.from(buf.subarray(start, start + len));
      if (mask) for (let i = 0; i < len; i++) data[i] ^= mask[i % 4];
      out.push({ op, data });
      o = start + len;
    }
    return [out, buf.subarray(o)];
  }

  const server = http.createServer();
  server.on('upgrade', (req, socket) => {
    const key = crypto.createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${key}\r\n\r\n`);
    let pending = Buffer.alloc(0);
    const send = (o) => socket.write(frame(o));
    socket.on('error', () => {});
    socket.on('data', (d) => {
      let msgs;
      [msgs, pending] = parse(Buffer.concat([pending, d]));
      for (const { op, data } of msgs) {
        if (op !== 1) continue;
        const { id, method, params = {}, sessionId } = JSON.parse(data.toString());
        fs.appendFileSync(log, JSON.stringify({ method, params, sessionId }) + '\n');
        const reply = (result = {}) => send({ id, result, ...(sessionId && { sessionId }) });
        const err = (message) => send({ id, error: { code: -32000, message }, ...(sessionId && { sessionId }) });
        const scripted = script.replies?.[method];
        const after = () => {
          for (const e of script.events?.[method] ?? []) send({ method: e.method, params: e.params, sessionId });
        };
        if (scripted) {
          const r = scripted[Math.min(used[method] ?? 0, scripted.length - 1)];
          used[method] = (used[method] ?? 0) + 1;
          if (r.hang) return;
          if (r.error) err(r.error);
          else reply(r);
          after();
        } else if (/^(Page|Network|Emulation)\./.test(method) && !sessionId) err(`${method} needs a sessionId`);
        else if (method === 'Target.createTarget') reply({ targetId: 'T1' });
        else if (method === 'Target.attachToTarget') {
          if (params.flatten !== true) err('attachToTarget needs flatten: true');
          else reply({ sessionId: 'S1' });
        } else if (method === 'Page.navigate') {
          if (mode === 'drop') return socket.destroy();
          if (mode === 'navfail') return reply({ frameId: 'F1', errorText: 'net::ERR_CONNECTION_REFUSED' });
          reply({ frameId: 'F1', loaderId: 'L1' });
          if (mode === 'eventsource') send({ method: 'Network.requestWillBeSent', params: { requestId: 'ES1', type: 'EventSource' }, sessionId });
          if (mode !== 'hang') send({ method: 'Page.loadEventFired', params: { timestamp: 1 }, sessionId });
        } else if (method === 'Page.captureScreenshot') {
          if (mode === 'shoterror') err('Unable to capture screenshot');
          else if (mode === 'emptyshot') reply({ data: '' });
          else if (mode === 'bigshot') reply({ data: Buffer.concat([Buffer.from(PNG, 'base64'), Buffer.alloc(70000)]).toString('base64') });
          else reply({ data: PNG });
        } else if (method === 'Browser.close') {
          if (mode === 'noclose') return;
          reply();
          setTimeout(() => process.exit(0), 20);
        } else {
          reply();
          after();
        }
      }
    });
  });
  server.listen(0, '127.0.0.1', () => {
    fs.writeFileSync(path.join(udd, 'DevToolsActivePort'), `${server.address().port}\n/devtools/browser/fake\n`);
  });
}
