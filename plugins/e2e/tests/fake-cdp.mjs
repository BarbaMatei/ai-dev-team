import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const udd = process.argv.find((a) => a.startsWith('--user-data-dir='))?.slice('--user-data-dir='.length);
const log = process.env.FAKE_CDP_LOG;
const mode = process.env.FAKE_CDP_MODE ?? '';
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

if (mode === 'nostart') setInterval(() => {}, 1000);
else {
  const frame = (obj) => {
    const p = Buffer.from(JSON.stringify(obj));
    const head = p.length < 126 ? Buffer.from([0x81, p.length]) : Buffer.from([0x81, 126, p.length >> 8, p.length & 255]);
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
    socket.on('data', (d) => {
      let msgs;
      [msgs, pending] = parse(Buffer.concat([pending, d]));
      for (const { op, data } of msgs) {
        if (op !== 1) continue;
        const { id, method, params = {}, sessionId } = JSON.parse(data.toString());
        fs.appendFileSync(log, JSON.stringify({ method, params }) + '\n');
        const reply = (result = {}) => send({ id, result, ...(sessionId && { sessionId }) });
        if (method === 'Target.createTarget') reply({ targetId: 'T1' });
        else if (method === 'Target.attachToTarget') reply({ sessionId: 'S1' });
        else if (method === 'Page.navigate') {
          reply({ frameId: 'F1' });
          send({ method: 'Page.loadEventFired', params: { timestamp: 1 }, sessionId });
        } else if (method === 'Page.captureScreenshot') {
          if (mode === 'shoterror') send({ id, error: { code: -32000, message: 'Unable to capture screenshot' }, sessionId });
          else reply({ data: PNG });
        } else if (method === 'Browser.close') {
          reply();
          setTimeout(() => process.exit(0), 20);
        } else reply();
      }
    });
  });
  server.listen(0, '127.0.0.1', () => {
    fs.writeFileSync(path.join(udd, 'DevToolsActivePort'), `${server.address().port}\n/devtools/browser/fake\n`);
  });
}
