import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PRESETS, getPreset, matchPreset, encodeScenario, decodeScenario, toJSON, fromJSON,
  randomScenario, seededRandom, baseScenario
} from '../web/core/scenarios.js';
import { validateScenario } from '../web/core/engine.js';

test('every preset is valid, unique and round-trips through a share code', () => {
  const codes = new Set();
  for (const p of PRESETS) {
    validateScenario(p.scenario);
    const code = encodeScenario(p.scenario);
    assert.ok(!codes.has(code), `duplicate preset ${p.id}`);
    codes.add(code);
    assert.deepEqual(decodeScenario(code), p.scenario);
    assert.equal(matchPreset(decodeScenario(code)), p.id);
  }
});

test('share code format is compact and readable', () => {
  assert.equal(encodeScenario(getPreset('airplane')), 'v1-d.u.u.u.u.u.u-11');
  assert.equal(encodeScenario(getPreset('paymentTimeout')), 'v1-u.u.u.u.s12000.u.u-11');
  assert.equal(encodeScenario(getPreset('firstLaunchOffline')), 'v1-d.u.u.u.u.u.u-00');
});

test('decode rejects bad codes', () => {
  for (const bad of ['', 'v2-u.u.u.u.u.u.u-11', 'v1-u.u.u-11', 'v1-u.u.u.u.u.u.x-11', 'v1-u.u.u.u.u.u.s0-11', 'v1-u.u.u.u.u.u.s99999-11', 'x'.repeat(300), 42]) {
    assert.throws(() => decodeScenario(bad), undefined, String(bad));
  }
});

test('getPreset returns an independent copy', () => {
  const a = getPreset('allGood');
  a.deps.internet.state = 'down';
  assert.equal(getPreset('allGood').deps.internet.state, 'up');
  assert.throws(() => getPreset('missing'));
});

test('JSON export and import round-trip and reject tampering', () => {
  const s = getPreset('congested');
  const text = toJSON(s, 'demo');
  assert.deepEqual(fromJSON(text), s);
  const doc = JSON.parse(text);
  doc.scenario.deps.payment.latencyMs = 10;
  assert.throws(() => fromJSON(JSON.stringify(doc)), /inconsistent/);
  assert.throws(() => fromJSON('{nope'), /not valid JSON/);
  assert.throws(() => fromJSON(JSON.stringify({ format: 'other' })), /Not an outage-lab/);
  assert.throws(() => fromJSON('x'.repeat(30000)), /too large/);
});

test('seeded chaos is reproducible and always valid', () => {
  const a = seededRandom(7);
  const b = seededRandom(7);
  for (let i = 0; i < 200; i += 1) {
    const s1 = randomScenario(a);
    const s2 = randomScenario(b);
    assert.deepEqual(s1, s2);
    validateScenario(s1);
    assert.deepEqual(decodeScenario(encodeScenario(s1)), s1);
  }
});

test('custom scenario matches no preset', () => {
  const s = baseScenario();
  s.deps.cdn = { state: 'slow', latencyMs: 700 };
  assert.equal(matchPreset(s), null);
});
