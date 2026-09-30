import { test } from 'node:test';
import http from 'node:http';
import assert from 'node:assert/strict';
import { createStaticServer } from '../scripts/serve.js';

// fetch() normalizes "..", so traversal attempts are sent raw.
function rawGet(base, path) {
  const { hostname, port } = new URL(base);
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname, port, path, method: 'GET' }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
    req.end();
  });
}

async function withServer(fn) {
  const server = createStaticServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(base);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('serves the app with correct content types', async () => {
  await withServer(async (base) => {
    const index = await fetch(`${base}/`);
    assert.equal(index.status, 200);
    assert.match(index.headers.get('content-type'), /text\/html/);
    assert.match(await index.text(), /<title>Outage Lab<\/title>/);
    const js = await fetch(`${base}/core/engine.js`);
    assert.match(js.headers.get('content-type'), /text\/javascript/);
    const manifest = await fetch(`${base}/manifest.webmanifest`);
    assert.match(manifest.headers.get('content-type'), /manifest\+json/);
  });
});

test('blocks traversal, bad methods and malformed paths', async () => {
  await withServer(async (base) => {
    assert.equal(await rawGet(base, '/..%2Fpackage.json'), 403);
    // URL parsing collapses encoded dot segments inside the web root, so the repo's package.json is never reachable.
    assert.equal(await rawGet(base, '/%2e%2e/%2e%2e/package.json'), 404);
    assert.equal(await rawGet(base, '/%00'), 400);
    assert.equal((await fetch(`${base}/missing.js`)).status, 404);
    assert.equal((await fetch(`${base}/`, { method: 'POST' })).status, 405);
    assert.equal((await fetch(`${base}/%E0%A4%A`)).status, 400);
  });
});
