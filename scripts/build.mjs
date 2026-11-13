// SPDX-License-Identifier: AGPL-3.0-or-later

import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync } from 'node:fs';

rmSync('dist', { recursive: true, force: true });
mkdirSync('dist', { recursive: true });
cpSync('public', 'dist', { recursive: true });

// One classic script: libsodium's WebAssembly is embedded in its own module, so nothing else is fetched
// and the page needs no third-party host at all.
await build({
  entryPoints: ['src/main.js'],
  outfile: 'dist/app.js',
  bundle: true,
  minify: true,
  format: 'iife',
  target: 'es2022',
  platform: 'browser',
  legalComments: 'none',
  // Only for trying the page against a local vault or API: VAULT_URL=http://127.0.0.1:8000 API_URL=... npm run build
  define: {
    ...(process.env.VAULT_URL ? { __VAULT_URL__: JSON.stringify(process.env.VAULT_URL) } : {}),
    ...(process.env.API_URL ? { __API_URL__: JSON.stringify(process.env.API_URL) } : {}),
  },
});
