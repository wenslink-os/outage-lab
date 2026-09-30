import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withTimeout, retry, CircuitBreaker, OfflineQueue, TimeoutError } from '../web/core/patterns.js';
import { createScaledClock } from '../web/core/clock.js';
import { createMemoryStore } from '../web/core/store.js';

const fakeClock = () => {
  const waits = [];
  return { waits, now: () => 0, sleep: (ms) => { waits.push(ms); return Promise.resolve(); } };
};

test('withTimeout resolves fast work and rejects slow work', async () => {
  const clock = createScaledClock(0.01);
  assert.equal(await withTimeout(async () => { await clock.sleep(100); return 'ok'; }, 3000, clock), 'ok');
  await assert.rejects(withTimeout(async () => { await clock.sleep(6000); return 'late'; }, 3000, clock), TimeoutError);
  await assert.rejects(withTimeout(async () => { throw new Error('boom'); }, 3000, clock), /boom/);
  await assert.rejects(withTimeout(async () => 1, 0, clock), /positive/);
});

test('retry uses exponential backoff capped at maxMs', async () => {
  const clock = fakeClock();
  let calls = 0;
  const seen = [];
  await assert.rejects(
    retry(async () => { calls += 1; throw new Error('nope'); }, { retries: 4, baseMs: 100, factor: 2, maxMs: 500, clock, onRetry: (e) => seen.push(e.attempt) }),
    /nope/
  );
  assert.equal(calls, 5);
  assert.deepEqual(clock.waits, [100, 200, 400, 500]);
  assert.deepEqual(seen, [1, 2, 3, 4]);
});

test('retry succeeds on a later attempt and respects shouldRetry', async () => {
  const clock = fakeClock();
  let n = 0;
  assert.equal(await retry(async () => { n += 1; if (n < 3) throw new Error('x'); return n; }, { retries: 5, clock }), 3);
  let m = 0;
  const fatal = Object.assign(new Error('fatal'), { code: 'FATAL' });
  await assert.rejects(retry(async () => { m += 1; throw fatal; }, { retries: 5, clock, shouldRetry: (e) => e.code !== 'FATAL' }), /fatal/);
  assert.equal(m, 1);
});

test('retry jitter stays within the backoff window', async () => {
  const clock = fakeClock();
  await assert.rejects(retry(async () => { throw new Error('x'); }, { retries: 3, baseMs: 100, jitter: true, random: () => 0.5, clock }));
  assert.deepEqual(clock.waits, [50, 100, 200]);
  await assert.rejects(retry(async () => 1, { clock: null }), /clock/);
});

test('circuit breaker opens, fails fast, half-opens and closes', async () => {
  let now = 0;
  const changes = [];
  const b = new CircuitBreaker({ name: 'backend', failureThreshold: 2, cooldownMs: 1000, now: () => now });
  b.onChange((c) => changes.push(`${c.from}>${c.to}`));
  let calls = 0;
  const fail = async () => { calls += 1; throw new Error('down'); };
  await assert.rejects(b.call(fail));
  await assert.rejects(b.call(fail));
  assert.equal(b.currentState(), 'open');
  await assert.rejects(b.call(fail), (e) => e.code === 'CIRCUIT_OPEN');
  assert.equal(calls, 2);
  now = 1000;
  assert.equal(b.currentState(), 'half-open');
  await assert.rejects(b.call(fail));
  assert.equal(b.currentState(), 'open');
  now = 2000;
  assert.equal(await b.call(async () => 'ok'), 'ok');
  assert.equal(b.currentState(), 'closed');
  assert.deepEqual(changes, ['closed>open', 'open>half-open', 'half-open>open', 'open>half-open', 'half-open>closed']);
});

test('offline queue keeps order and stops at the first failure', async () => {
  const q = new OfflineQueue(createMemoryStore());
  await q.enqueue('a', 1, 'a1');
  await q.enqueue('b', 2, 'b1');
  await q.enqueue('c', 3, 'c1');
  const handled = [];
  const r = await q.flush(async (item) => { if (item.type === 'b') throw new Error('still down'); handled.push(item.id); });
  assert.deepEqual(handled, ['a1']);
  assert.equal(r.remaining, 2);
  assert.equal(r.failed.item.id, 'b1');
  const items = await q.items();
  assert.equal(items[0].attempts, 1);
  const r2 = await q.flush(async (item) => handled.push(item.id));
  assert.equal(r2.remaining, 0);
  assert.deepEqual(handled, ['a1', 'b1', 'c1']);
  await q.enqueue('d', 4);
  await q.clear();
  assert.equal(await q.size(), 0);
});
