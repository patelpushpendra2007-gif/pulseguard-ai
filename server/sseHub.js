// Real-Time Server-Sent Events (SSE) Broadcast Hub

const clients = new Set();

export function addSseClient(res, user) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });

  const client = { res, userId: user.id, role: user.role };
  clients.add(client);

  res.write(`event: connected\ndata: ${JSON.stringify({ ok: true, userId: user.id, role: user.role })}\n\n`);

  const keepAlive = setInterval(() => {
    try {
      res.write(`: heartbeat ${Date.now()}\n\n`);
    } catch {
      clearInterval(keepAlive);
      clients.delete(client);
    }
  }, 20000);

  res.on('close', () => {
    clearInterval(keepAlive);
    clients.delete(client);
  });
}

export function broadcastEvent(eventName, payload) {
  const frame = `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const client of clients) {
    try {
      client.res.write(frame);
    } catch {
      clients.delete(client);
    }
  }
}
