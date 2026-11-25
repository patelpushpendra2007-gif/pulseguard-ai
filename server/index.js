import 'dotenv/config';
import app from './app.js';

const PORT = parseInt(process.env.PORT || '4000', 10);

const server = app.listen(PORT, () => {
  console.log(`\n  PulseGuard AI v4.0 Backend running on http://localhost:${PORT}`);
  console.log(`  API Health: http://localhost:${PORT}/api/health\n`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use.`);
    process.exit(1);
  }
  throw err;
});
