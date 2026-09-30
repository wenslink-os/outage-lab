import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indexedDB } from 'fake-indexeddb';
import { createMemoryStore, createIndexedDBStore, openBestStore } from '../web/core/store.js';

async function exercise(store) {
  assert.equal(await store.get('missing'), undefined);
  const value = { list: [1, 2], nested: { ok: true } };
  await store.set('b', value);
  await store.set('a', 1);
  value.list.push(3);
  assert.deepEqual(await store.get('b'), { list: [1, 2], nested: { ok: true } });
  const read = await store.get('b');
  read.list.push(9);
  assert.deepEqual((await store.get('b')).list, [1, 2]);
  assert.deepEqual(await store.keys(), ['a', 'b']);
  await store.delete('a');
  assert.deepEqual(await store.keys(), ['b']);
  await store.clear();
  assert.deepEqual(await store.keys(), []);
}

test('memory store isolates stored values', async () => {
  await exercise(createMemoryStore());
});

test('IndexedDB store works and persists across reopen', async () => {
  const s1 = await createIndexedDBStore({ indexedDB, dbName: 'test-db' });
  assert.equal(s1.kind, 'indexeddb');
  await exercise(s1);
  await s1.set('kept', { v: 1 });
  s1.close();
  const s2 = await createIndexedDBStore({ indexedDB, dbName: 'test-db' });
  assert.deepEqual(await s2.get('kept'), { v: 1 });
  s2.close();
});

test('openBestStore falls back to memory when IndexedDB is missing', async () => {
  const r = await openBestStore(undefined);
  assert.equal(r.persistent, false);
  assert.equal(r.store.kind, 'memory');
  assert.match(r.reason, /not available/);
  const ok = await openBestStore(indexedDB);
  assert.equal(ok.persistent, true);
  ok.store.close();
});
