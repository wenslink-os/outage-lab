// Zero-dependency static file server for local development. Serves ./web on 127.0.0.1.
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8'
};

export const WEB_ROOT = resolve(fileURLToPath(new URL('../web', import.meta.url)));

export function createStaticServer(root = WEB_ROOT) {
  return http.createServer(async (req, res) => {
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { Allow: 'GET, HEAD' }).end('Method not allowed');
        return;
      }
      let pathname;
      try {
        pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      } catch {
        res.writeHead(400).end('Bad request');
        return;
      }
      if (pathname.includes('\0')) {
        res.writeHead(400).end('Bad request');
        return;
      }
      let file = normalize(join(root, pathname));
      if (file !== root && !file.startsWith(root + sep)) {
        res.writeHead(403).end('Forbidden');
        return;
      }
      const info = await stat(file).catch(() => null);
      if (info && info.isDirectory()) file = join(file, 'index.html');
      const body = await readFile(file).catch(() => null);
      if (!body) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
        return;
      }
      res.writeHead(200, {
        'Content-Type': MIME[extname(file)] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff'
      });
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Server error');
      console.error(`[serve] ${error.message}`);
    }
  });
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const port = Number(process.env.PORT) || 8080;
  const host = process.env.HOST || '127.0.0.1';
  createStaticServer()
    .on('error', (error) => {
      console.error(`[serve] could not start: ${error.message}`);
      process.exit(1);
    })
    .listen(port, host, () => console.log(`[serve] Outage Lab at http://${host === '127.0.0.1' ? 'localhost' : host}:${port}`));
}
