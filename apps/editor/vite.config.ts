import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { handleUnsplash } from '../../api/unsplash.ts';
import { handleNvidia } from '../../api/nvidia.ts';

// Serves /api/unsplash in dev with the same handler Vercel runs. The key comes from the
// environment or a file outside the repo, read per request so it can be added without a restart.
function unsplashDev(): Plugin {
  const keyFile = join(homedir(), '.config/opentempl/unsplash.key');
  const readKey = () => {
    if (process.env.UNSPLASH_ACCESS_KEY) return process.env.UNSPLASH_ACCESS_KEY;
    try {
      return readFileSync(keyFile, 'utf8').trim() || undefined;
    } catch {
      return undefined;
    }
  };
  return {
    name: 'opentempl-unsplash-dev',
    configureServer(server) {
      server.middlewares.use('/api/unsplash', async (req, res) => {
        const query = Object.fromEntries(new URL(req.url ?? '', 'http://localhost').searchParams);
        const out = await handleUnsplash(query, readKey());
        res.statusCode = out.status;
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-store');
        res.end(JSON.stringify(out.body));
      });
    },
  };
}

function nvidiaDev(): Plugin {
  return {
    name: 'opentempl-nvidia-dev',
    configureServer(server) {
      server.middlewares.use('/api/nvidia', async (req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Access-Control-Allow-Origin', '*');
        if (req.method === 'OPTIONS') {
          res.statusCode = 204;
          res.end();
          return;
        }
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end(JSON.stringify({ error: { message: 'Use POST.' } }));
          return;
        }
        let raw = '';
        for await (const chunk of req) raw += chunk;
        if (raw.length > 300000) {
          res.statusCode = 413;
          res.end(JSON.stringify({ error: { message: 'The design request is too large.' } }));
          return;
        }
        let body: { model?: unknown; messages?: unknown } = {};
        try {
          body = JSON.parse(raw) as { model?: unknown; messages?: unknown };
        } catch {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: { message: 'The design request is not valid.' } }));
          return;
        }
        const authorization = req.headers.authorization;
        const out = await handleNvidia({ authorization, model: body.model, messages: body.messages });
        res.statusCode = out.status;
        res.end(JSON.stringify(out.body));
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), unsplashDev(), nvidiaDev()],
  base: './',
  server: { host: true },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000, outDir: '../../dist/app', emptyOutDir: true },
  define: { global: 'globalThis' },
  // pptxgenjs reaches into jszip in a way the dev pre-bundler misses unless told.
  optimizeDeps: { include: ['pptxgenjs', 'jszip', 'pdfjs-dist', 'gifenc', 'peerjs', 'polygon-clipping'] },
});
