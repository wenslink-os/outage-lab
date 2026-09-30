// The declarative engine and the real client implementations must agree.
// This is the project's core honesty check: the table in the UI describes what the code actually does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PRESETS, cloneScenario, randomScenario, seededRandom, getPreset } from '../web/core/scenarios.js';
import { evaluate, effectiveStatus, DEFAULT_TIMEOUT_MS } from '../web/core/engine.js';
import { createServices } from '../web/core/services.js';
import { createFragileClient, createResilientClient } from '../web/core/clients.js';
import { createScaledClock } from '../web/core/clock.js';
import { createMemoryStore } from '../web/core/store.js';

const SCALE = 0.02;
const BASE_LATENCY = 30;

async function runBoth(scenario) {
  const clock = createScaledClock(SCALE);
  const getScenario = () => scenario;
  const fragile = createFragileClient({ services: createServices({ getScenario, clock, baseLatencyMs: BASE_LATENCY }), clock });
  const services = createServices({ getScenario, clock, baseLatencyMs: BASE_LATENCY });
  const resilient = createResilientClient({ services, clock, store: createMemoryStore() });
  await resilient.seed(scenario.context);
  const [f, r] = await Promise.all([fragile.runJourney(), resilient.runJourney()]);
  return { f, r, resilient, services };
}

function compare(label, scenario, f, r) {
  const ev = evaluate(scenario);
  for (const [steps, mode] of [[f, 'fragile'], [r, 'resilient']]) {
    for (const s of steps) {
      assert.equal(s.status, ev.features[s.feature][mode].status, `${label} ${mode} ${s.feature}: ${JSON.stringify(s.notes)}`);
    }
  }
}

for (const p of PRESETS) {
  test(`engine matches real clients: ${p.id}`, async () => {
    const scenario = cloneScenario(p.scenario);
    const { f, r } = await runBoth(scenario);
    compare(p.id, scenario, f, r);
  });
}

test('engine matches real clients on 40 seeded random outages', async () => {
  const rnd = seededRandom(20260930);
  let checked = 0;
  while (checked < 40) {
    const scenario = randomScenario(rnd);
    // Skip latencies within 500 ms of the timeout: wall-clock jitter could flip them either way.
    const eff = effectiveStatus(scenario, Number.POSITIVE_INFINITY);
    if (Object.values(eff).some((e) => Math.abs(e.latencyMs + BASE_LATENCY - DEFAULT_TIMEOUT_MS) < 500)) continue;
    const { f, r } = await runBoth(scenario);
    compare(`chaos#${checked}`, scenario, f, r);
    checked += 1;
  }
});

test('queued checkout is paid exactly once after recovery', async () => {
  const scenario = getPreset('paymentTimeout');
  const clock = createScaledClock(SCALE);
  const services = createServices({ getScenario: () => scenario, clock });
  const client = createResilientClient({ services, clock, store: createMemoryStore() });
  await client.seed(scenario.context);
  await client.runJourney();
  assert.equal(await client.queue.size(), 1);
  // The timed-out charge may still land later on the provider side; the idempotent key protects us.
  scenario.deps.payment = { state: 'up', latencyMs: 0 };
  // Three timeouts opened the payment breaker; wait out its cooldown before replaying.
  await clock.sleep(5100);
  const flushed = await client.flushQueue();
  assert.equal(flushed.remaining, 0);
  assert.equal(services.ledger.size, 1);
  await client.flushQueue();
  assert.equal(services.ledger.size, 1);
});

test('flush stops while the outage continues and keeps the work', async () => {
  const scenario = getPreset('airplane');
  const clock = createScaledClock(SCALE);
  const services = createServices({ getScenario: () => scenario, clock });
  const client = createResilientClient({ services, clock, store: createMemoryStore() });
  await client.seed(scenario.context);
  await client.runJourney();
  assert.equal(await client.queue.size(), 2);
  const r = await client.flushQueue();
  assert.equal(r.remaining, 2);
  assert.equal(services.orders.size, 0);
  scenario.deps.internet = { state: 'up', latencyMs: 0 };
  // Breakers opened during the outage need their cooldown before they allow a trial call.
  await clock.sleep(5100);
  const r2 = await client.flushQueue();
  assert.equal(r2.remaining, 0);
  assert.equal(services.orders.size, 1);
  assert.equal(services.ledger.size, 1);
  assert.equal(services.outbox.length, 1);
});

test('exported device data contains the cart and queue', async () => {
  const scenario = getPreset('backendDown');
  const clock = createScaledClock(SCALE);
  const client = createResilientClient({ services: createServices({ getScenario: () => scenario, clock }), clock, store: createMemoryStore() });
  await client.seed(scenario.context);
  await client.runJourney();
  const data = await client.exportData();
  assert.deepEqual(data.cart, ['tea']);
  assert.equal(data.queue.length, 1);
  assert.equal(data.queue[0].type, 'checkout');
});
