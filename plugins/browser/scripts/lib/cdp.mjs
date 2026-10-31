export function connect(url) {
  const ws = new WebSocket(url);
  let nextId = 1;
  const pending = new Map();
  const handlers = [];
  const fail = (err) => {
    for (const p of pending.values()) p.reject(err);
    pending.clear();
  };
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(String(ev.data));
    if (msg.id !== undefined) {
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message ?? 'protocol error'));
      else p.resolve(msg.result ?? {});
    } else if (msg.method) {
      for (const h of [...handlers]) h(msg.method, msg.params ?? {}, msg.sessionId);
    }
  });
  const closed = new Promise((r) => ws.addEventListener('close', r, { once: true }));
  ws.addEventListener('close', () => fail(new Error('connection closed')));
  return new Promise((resolve, reject) => {
    ws.addEventListener('error', () => reject(new Error('connection failed')), { once: true });
    ws.addEventListener(
      'open',
      () =>
        resolve({
          send: (method, params = {}, sessionId) =>
            new Promise((res, rej) => {
              const id = nextId++;
              pending.set(id, { resolve: res, reject: rej });
              ws.send(JSON.stringify({ id, method, params, ...(sessionId && { sessionId }) }));
            }),
          on(fn) {
            handlers.push(fn);
            return () => handlers.splice(handlers.indexOf(fn), 1);
          },
          closed,
          close: () => ws.close(),
        }),
      { once: true },
    );
  });
}
