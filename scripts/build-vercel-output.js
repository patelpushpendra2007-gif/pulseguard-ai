import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, '.vercel', 'output');
const STATIC_DIR = path.join(OUT, 'static');
const FUNC_DIR = path.join(OUT, 'functions', 'api', 'index.func');

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(STATIC_DIR, { recursive: true });
fs.mkdirSync(FUNC_DIR, { recursive: true });

// 1. Copy Vite dist/ -> .vercel/output/static/
fs.cpSync(path.join(ROOT, 'dist'), STATIC_DIR, { recursive: true });

// 2. Bundle api/index.js -> .vercel/output/functions/api/index.func/index.mjs
await build({
  entryPoints: [path.join(ROOT, 'api', 'index.js')],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  outfile: path.join(FUNC_DIR, 'index.mjs'),
  external: ['node:*'],
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);"
  }
});

// 3. Write function package.json & .vc-config.json
fs.writeFileSync(
  path.join(FUNC_DIR, 'package.json'),
  JSON.stringify({ type: 'module' }, null, 2)
);

fs.writeFileSync(
  path.join(FUNC_DIR, '.vc-config.json'),
  JSON.stringify(
    {
      runtime: 'nodejs22.x',
      handler: 'index.mjs',
      launcherType: 'Nodejs',
      shouldAddHelpers: true
    },
    null,
    2
  )
);

// 4. Write Build Output API v3 config.json
fs.writeFileSync(
  path.join(OUT, 'config.json'),
  JSON.stringify(
    {
      version: 3,
      routes: [
        { src: '^/api/(.*)$', dest: '/api/index' },
        { handle: 'filesystem' },
        { src: '^/(.*)$', dest: '/index.html' }
      ]
    },
    null,
    2
  )
);

console.log('Built .vercel/output cleanly:', OUT);
