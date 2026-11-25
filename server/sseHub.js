// Real-Time Server-Sent Events (SSE) Broadcast Hub

const isServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
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

  res.write(`retry: ${isServerless ? 8000 : 3000}\nevent: connected\ndata: ${JSON.stringify({ ok: true, userId: user.id, role: user.role })}\n\n`);

  const keepAlive = setInterval(() => {
    try {
      res.write(`: heartbeat ${Date.now()}\n\n`);
    } catch {
      cleanup();
    }
  }, 15000);

  // Close cleanly before Vercel's 300s Lambda timeout so EventSource reconnects gracefully.
  const serverlessTimer = isServerless
    ? setTimeout(() => {
        cleanup();
        try {
          res.end();
        } catch {
          // already closed
        }
      }, 25000)
    : null;

  function cleanup() {
    clearInterval(keepAlive);
    if (serverlessTimer) clearTimeout(serverlessTimer);
    clients.delete(client);
  }

  res.on('close', cleanup);
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
