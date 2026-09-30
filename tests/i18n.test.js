import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STRINGS, LANGUAGES, translate } from '../web/core/i18n.js';
import { DEPENDENCY_IDS } from '../web/core/dependencies.js';
import { FEATURE_IDS } from '../web/core/features.js';
import { FALLBACKS } from '../web/core/features.js';
import { PRESETS } from '../web/core/scenarios.js';

const placeholders = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

test('every language has exactly the same keys and placeholders', () => {
  const en = STRINGS.en;
  for (const lang of LANGUAGES) {
    assert.deepEqual(Object.keys(STRINGS[lang]).sort(), Object.keys(en).sort(), lang);
    for (const key of Object.keys(en)) {
      assert.deepEqual(placeholders(STRINGS[lang][key]), placeholders(en[key]), `${lang}:${key}`);
    }
  }
});

test('every domain id has a label', () => {
  const needed = [
    ...DEPENDENCY_IDS.map((id) => `dep.${id}`),
    ...FEATURE_IDS.map((id) => `feature.${id}`),
    ...Object.keys(FALLBACKS).map((id) => `fallback.${id}`),
    ...PRESETS.map((p) => `preset.${p.id}`),
    'state.up', 'state.slow', 'state.down', 'state.timeout',
    'status.working', 'status.degraded', 'status.broken'
  ];
  for (const lang of LANGUAGES) for (const key of needed) assert.ok(key in STRINGS[lang], `${lang}:${key}`);
});

test('no em dash in any UI string', () => {
  for (const lang of LANGUAGES) for (const [k, v] of Object.entries(STRINGS[lang])) assert.ok(!v.includes('\u2014'), `${lang}:${k}`);
});

test('translate fills placeholders and falls back to English', () => {
  assert.equal(translate('en', 'latency.label', { ms: 500 }), 'Delay: 500 ms');
  assert.equal(translate('as', 'latency.label', { ms: 500 }), 'বিলম্ব: 500 ms');
  assert.equal(translate('xx', 'state.up'), 'Up');
  assert.throws(() => translate('en', 'no.such.key'), /Missing string/);
});
