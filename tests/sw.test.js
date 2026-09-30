import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB = fileURLToPath(new URL('../web', import.meta.url));

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(p)));
    else out.push(p);
  }
  return out;
}

test('service worker caches every shipped file and nothing that does not exist', async () => {
  const sw = await readFile(join(WEB, 'sw.js'), 'utf8');
  const block = /const ASSETS = \[([\s\S]*?)\];/.exec(sw);
  assert.ok(block, 'ASSETS array not found in sw.js');
  const listed = [...block[1].matchAll(/'\.\/([^']*)'/g)].map((m) => m[1]).filter(Boolean).sort();
  assert.equal(new Set(listed).size, listed.length, 'duplicate entries in ASSETS');
  const files = (await walk(WEB)).map((p) => relative(WEB, p).split('\\').join('/')).filter((p) => p !== 'sw.js').sort();
  assert.deepEqual(listed, files);
});

test('the app makes no external network requests', async () => {
  for (const file of await walk(WEB)) {
    const text = await readFile(file, 'utf8');
    const urls = [
      ...text.matchAll(/<(?:script|link|img|iframe|source)[^>]+(?:src|href)=["'](?:https?:)?\/\//g),
      ...text.matchAll(/url\(\s*['"]?(?:https?:)?\/\//g),
      ...text.matchAll(/import[^'"]*['"](?:https?:)?\/\//g)
    ];
    const fetches = [...text.matchAll(/fetch\(\s*['"`]https?:/g)];
    assert.equal(fetches.length, 0, file);
    for (const u of urls) assert.fail(`${file} loads an external resource: ${u[0]}`);
  }
});
