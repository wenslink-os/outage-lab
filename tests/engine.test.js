import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, effectiveStatus, suiteScore, dependents, validateScenario, DEFAULT_TIMEOUT_MS } from '../web/core/engine.js';
import { baseScenario, getPreset, PRESETS } from '../web/core/scenarios.js';
import { FEATURE_IDS } from '../web/core/features.js';

const statuses = (r, mode) => Object.fromEntries(FEATURE_IDS.map((id) => [id, r.features[id][mode].status]));

test('healthy world: everything works in both designs', () => {
  const r = evaluate(baseScenario());
  assert.deepEqual(r.score, { fragile: 100, resilient: 100 });
  for (const id of FEATURE_IDS) {
    assert.equal(r.features[id].fragile.status, 'working');
    assert.equal(r.features[id].resilient.status, 'working');
  }
});

test('internet down propagates to every remote dependency with the right cause', () => {
  const eff = effectiveStatus(getPreset('airplane'));
  for (const id of ['backend', 'auth', 'payment', 'email', 'cdn']) {
    assert.equal(eff[id].state, 'down');
    assert.equal(eff[id].cause, 'internet');
  }
  assert.equal(eff.dns.state, 'up');
});

test('latency adds up along the network chain and crosses the timeout', () => {
  const s = getPreset('congested');
  const eff = effectiveStatus(s);
  assert.equal(eff.backend.state, 'slow');
  assert.equal(eff.backend.latencyMs, 1800);
  assert.equal(eff.payment.state, 'timeout');
  assert.equal(eff.payment.latencyMs, 3400);
  assert.equal(eff.payment.cause, 'internet');
});

test('airplane mode: local-first design keeps working offline', () => {
  const r = evaluate(getPreset('airplane'));
  assert.deepEqual(statuses(r, 'fragile'), Object.fromEntries(FEATURE_IDS.map((id) => [id, 'broken'])));
  assert.deepEqual(statuses(r, 'resilient'), {
    login: 'degraded', catalog: 'degraded', images: 'degraded', search: 'degraded',
    cart: 'working', checkout: 'degraded', receipt: 'degraded', export: 'working'
  });
  assert.equal(r.score.fragile, 0);
  assert.equal(r.score.resilient, 63);
});

test('first launch offline: nothing cached means fallbacks are impossible', () => {
  const r = evaluate(getPreset('firstLaunchOffline'));
  const res = statuses(r, 'resilient');
  assert.equal(res.login, 'broken');
  assert.equal(res.catalog, 'broken');
  assert.equal(res.search, 'broken');
  assert.equal(res.checkout, 'broken');
  assert.equal(res.cart, 'working');
  const reason = r.features.catalog.resilient.reasons[0];
  assert.equal(reason.outcome, 'fail');
  assert.equal(reason.fallback, 'cache');
});

test('payment timeout: fragile hangs, resilient times out and queues', () => {
  const r = evaluate(getPreset('paymentTimeout'));
  const f = r.features.checkout.fragile;
  assert.equal(f.status, 'broken');
  assert.equal(f.reasons[0].outcome, 'hang');
  const res = r.features.checkout.resilient;
  assert.equal(res.status, 'degraded');
  assert.equal(res.reasons[0].fallback, 'queue');
});

test('email outage breaks fragile checkout through hidden coupling', () => {
  const r = evaluate(getPreset('emailDown'));
  assert.equal(r.features.checkout.fragile.status, 'broken');
  assert.equal(r.features.checkout.resilient.status, 'working');
  assert.equal(r.features.receipt.resilient.status, 'degraded');
});

test('slow but under the timeout still counts as working', () => {
  const s = baseScenario();
  s.deps.backend = { state: 'slow', latencyMs: DEFAULT_TIMEOUT_MS - 1 };
  const r = evaluate(s);
  assert.equal(r.features.catalog.fragile.status, 'working');
  assert.equal(r.features.catalog.resilient.reasons[0].outcome, 'slow');
});

test('resilient never scores below fragile on any preset', () => {
  for (const p of PRESETS) {
    const r = evaluate(p.scenario);
    assert.ok(r.score.resilient >= r.score.fragile, p.id);
  }
});

test('suite score averages presets', () => {
  const s = suiteScore(PRESETS.map((p) => p.scenario));
  assert.ok(s.resilient > s.fragile);
  assert.throws(() => suiteScore([]));
});

test('dependents lists callers per mode', () => {
  assert.deepEqual(dependents('email', 'fragile'), ['checkout', 'receipt']);
  assert.deepEqual(dependents('email', 'resilient'), ['receipt']);
  assert.throws(() => dependents('email', 'nope'));
});

test('validateScenario rejects malformed input', () => {
  const s = baseScenario();
  s.deps.dns = { state: 'sideways', latencyMs: 0 };
  assert.throws(() => validateScenario(s), /Invalid state for dns/);
  const s2 = baseScenario();
  s2.deps.cdn.latencyMs = -1;
  assert.throws(() => validateScenario(s2), /Invalid latency/);
  assert.throws(() => validateScenario({ deps: baseScenario().deps }), /context/);
  assert.throws(() => evaluate(null));
});
