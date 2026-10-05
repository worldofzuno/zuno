/**
 * The shop, running on this machine, for the browser tests.
 *
 * Netlify serves `site/` as files and `netlify/functions/*` as endpoints.
 * This does the same thing with forty lines of `node:http`, so a test can
 * drive the real page against the real functions instead of a mock of
 * either. State goes to the in-memory store, mail goes nowhere, and no
 * Stripe key is present — the one call that needs Stripe is intercepted by
 * the test itself, which is also the only way to see what the cart sent.
 *
 * Run it on its own to poke at the shop by hand:
 *
 *     node tests/browser/serve.mjs 8820
 */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../site/', import.meta.url));
const FUNCTIONS = new URL('../../netlify/functions/', import.meta.url);

/* Only the files that are endpoints. The rest of that folder is modules
   the endpoints import — which Netlify also publishes, and which answer
   502 there; here they are simply not routed. */
const ENDPOINTS = ['account', 'admin', 'checkout-status', 'create-checkout-session',
  'stock-levels', 'stripe-webhook', 'validate-code'];

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json', '.xml': 'application/xml',
  '.txt': 'text/plain; charset=utf-8',
};

const loaded = new Map();
async function endpoint(name) {
  if (!loaded.has(name)) loaded.set(name, import(new URL(`${name}.mjs`, FUNCTIONS)));
  return (await loaded.get(name)).default;
}

async function body(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return chunks.length ? Buffer.concat(chunks) : undefined;
}

export function serve(port = 0) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    /* ---- functions ---- */
    const fn = url.pathname.match(/^\/\.netlify\/functions\/([a-z-]+)$/);
    if (fn) {
      if (!ENDPOINTS.includes(fn[1])) { res.writeHead(404).end('no such function'); return; }
      try {
        const handler = await endpoint(fn[1]);
        const request = new Request(url, {
          method: req.method,
          headers: req.headers,
          body: await body(req),
          duplex: 'half',
        });
        const out = await handler(request);
        const headers = {};
        for (const [k, v] of out.headers) if (k !== 'set-cookie') headers[k] = v;
        const cookies = out.headers.getSetCookie ? out.headers.getSetCookie() : [];
        if (cookies.length) headers['set-cookie'] = cookies;
        res.writeHead(out.status, headers);
        res.end(Buffer.from(await out.arrayBuffer()));
      } catch (e) {
        /* Loud: a 500 here is a bug in the shop, and a test that saw a
           polite empty answer instead would pass for the wrong reason. */
        console.error(`[harness] ${fn[1]} threw:`, e);
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: String((e && e.message) || e) }));
      }
      return;
    }

    /* ---- files, with index.html as the catch-all, as netlify.toml has it ---- */
    let path = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
    if (path.endsWith('/')) path += 'index.html';
    let file = join(ROOT, path);
    try {
      const s = await stat(file);
      if (s.isDirectory()) file = join(file, 'index.html');
    } catch {
      file = join(ROOT, 'index.html');
    }
    try {
      const data = await readFile(file);
      res.writeHead(200, {
        'content-type': TYPES[extname(file)] || 'application/octet-stream',
        'cache-control': 'no-store',
      });
      res.end(data);
    } catch {
      res.writeHead(404).end('not found');
    }
  });

  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      resolve({ server, port: server.address().port });
    });
  });
}

/* Started directly rather than imported. */
if (process.argv[1] && process.argv[1].endsWith('serve.mjs')) {
  const { port } = await serve(Number(process.argv[2]) || 8820);
  console.log(`shop on http://127.0.0.1:${port}`);
}
