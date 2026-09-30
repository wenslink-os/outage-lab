import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { STRINGS, translate } from '../web/core/i18n.js';
import { DEPENDENCY_IDS } from '../web/core/dependencies.js';
import { FEATURE_IDS } from '../web/core/features.js';
import { FALLBACKS } from '../web/core/features.js';
import { PRESETS } from '../web/core/scenarios.js';

test('every domain id has an English label', () => {
  const needed = [
    ...DEPENDENCY_IDS.map((id) => `dep.${id}`),
    ...FEATURE_IDS.map((id) => `feature.${id}`),
    ...Object.keys(FALLBACKS).map((id) => `fallback.${id}`),
    ...PRESETS.map((p) => `preset.${p.id}`),
    'state.up', 'state.slow', 'state.down', 'state.timeout',
    'status.working', 'status.degraded', 'status.broken'
  ];
  for (const key of needed) assert.ok(Object.hasOwn(STRINGS, key), key);
});

test('every key the UI looks up exists in English', async () => {
  const source = (await Promise.all(['../web/ui/app.js', '../web/ui/graph.js'].map((f) => readFile(new URL(f, import.meta.url), 'utf8')))).join('\n');
  const literal = [...source.matchAll(/\bt\(\s*'([\w.]+)'/g)].map((m) => m[1]);
  assert.ok(literal.length > 20, 'expected to find the UI string lookups');
  for (const key of literal) assert.ok(Object.hasOwn(STRINGS, key), key);
  for (const mode of ['fragile', 'resilient']) {
    for (const key of [`mode.${mode}`, `mode.${mode}Hint`]) assert.ok(Object.hasOwn(STRINGS, key), key);
  }
});

test('every string is non-empty English text', () => {
  for (const [k, v] of Object.entries(STRINGS)) {
    assert.equal(typeof v, 'string', k);
    assert.ok(v.trim().length > 0, k);
    assert.ok(!/[\u0980-\u09FF]/.test(v), `${k} contains Bengali-script text`);
  }
});

test('no em dash in any UI string', () => {
  for (const [k, v] of Object.entries(STRINGS)) assert.ok(!v.includes('\u2014'), k);
});

test('translate fills placeholders and rejects unknown keys', () => {
  assert.equal(translate('latency.label', { ms: 500 }), 'Delay: 500 ms');
  assert.equal(translate('state.up'), 'Up');
  assert.equal(translate('journey.took'), '{ms} ms');
  assert.throws(() => translate('no.such.key'), /Missing string/);
  assert.throws(() => translate('toString'), /Missing string/);
});
