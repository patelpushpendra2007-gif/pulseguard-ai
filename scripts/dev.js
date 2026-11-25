import { spawn } from 'node:child_process';

const isWin = process.platform === 'win32';
const npxCmd = isWin ? 'npx.cmd' : 'npx';

const backend = spawn(process.execPath, ['server/index.js'], { stdio: 'inherit' });
const frontend = spawn(npxCmd, ['vite'], { stdio: 'inherit', shell: isWin });

function shutdown() {
  backend.kill();
  frontend.kill();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
