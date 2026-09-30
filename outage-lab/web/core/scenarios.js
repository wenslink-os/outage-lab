import { DEPENDENCY_IDS, MAX_LATENCY_MS } from './dependencies.js';
import { validateScenario } from './engine.js';

export function baseScenario() {
  const deps = {};
  for (const id of DEPENDENCY_IDS) deps[id] = { state: 'up', latencyMs: 0 };
  return { deps, context: { cacheWarm: true, hasSession: true } };
}

export function cloneScenario(s) {
  const deps = {};
  for (const id of DEPENDENCY_IDS) deps[id] = { state: s.deps[id].state, latencyMs: s.deps[id].latencyMs };
  return { deps, context: { cacheWarm: s.context.cacheWarm, hasSession: s.context.hasSession } };
}

function make(changes, context) {
  const s = baseScenario();
  for (const [id, value] of Object.entries(changes)) {
    s.deps[id] = typeof value === 'string' ? { state: value, latencyMs: 0 } : { state: 'slow', latencyMs: value };
  }
  if (context) Object.assign(s.context, context);
  return s;
}

// Each preset is a named, reproducible outage. A number means "slow" with that latency in ms.
export const PRESETS = Object.freeze([
  { id: 'allGood', scenario: make({}) },
  { id: 'airplane', scenario: make({ internet: 'down' }) },
  { id: 'dnsDown', scenario: make({ dns: 'down' }) },
  { id: 'loginDown', scenario: make({ auth: 'down' }) },
  { id: 'paymentTimeout', scenario: make({ payment: 12000 }) },
  { id: 'backendDown', scenario: make({ backend: 'down' }) },
  { id: 'emailDown', scenario: make({ email: 'down' }) },
  { id: 'cdnDown', scenario: make({ cdn: 'down' }) },
  { id: 'congested', scenario: make({ internet: 1800, payment: 1600 }) },
  { id: 'firstLaunchOffline', scenario: make({ internet: 'down' }, { cacheWarm: false, hasSession: false }) },
  { id: 'everythingDown', scenario: make(Object.fromEntries(DEPENDENCY_IDS.map((id) => [id, 'down']))) }
]);

export function getPreset(id) {
  const p = PRESETS.find((x) => x.id === id);
  if (!p) throw new Error(`Unknown preset: ${id}`);
  return cloneScenario(p.scenario);
}

/** Identify which preset (if any) a scenario equals. */
export function matchPreset(scenario) {
  const code = encodeScenario(scenario);
  const p = PRESETS.find((x) => encodeScenario(x.scenario) === code);
  return p ? p.id : null;
}

/**
 * Compact, URL-safe share code, e.g. "v1-u.u.d.u.s1500.u.u-11".
 * One token per dependency in DEPENDENCY_IDS order, then cacheWarm and hasSession bits.
 */
export function encodeScenario(scenario) {
  validateScenario(scenario);
  const tokens = DEPENDENCY_IDS.map((id) => {
    const d = scenario.deps[id];
    if (d.state === 'slow') return `s${Math.round(d.latencyMs)}`;
    return d.state === 'up' ? 'u' : 'd';
  });
  const bits = `${scenario.context.cacheWarm ? 1 : 0}${scenario.context.hasSession ? 1 : 0}`;
  return `v1-${tokens.join('.')}-${bits}`;
}

export function decodeScenario(code) {
  if (typeof code !== 'string' || code.length > 200) throw new Error('Share code must be a short string');
  const m = /^v1-([a-z0-9.]+)-([01])([01])$/.exec(code.trim());
  if (!m) throw new Error('Share code has an unknown format');
  const tokens = m[1].split('.');
  if (tokens.length !== DEPENDENCY_IDS.length) throw new Error('Share code has the wrong number of dependencies');
  const s = baseScenario();
  tokens.forEach((t, i) => {
    const id = DEPENDENCY_IDS[i];
    if (t === 'u') s.deps[id] = { state: 'up', latencyMs: 0 };
    else if (t === 'd') s.deps[id] = { state: 'down', latencyMs: 0 };
    else {
      const sm = /^s(\d{1,5})$/.exec(t);
      if (!sm) throw new Error(`Share code has an invalid token for ${id}`);
      const latencyMs = Number(sm[1]);
      if (latencyMs < 1 || latencyMs > MAX_LATENCY_MS) throw new Error(`Latency for ${id} is out of range`);
      s.deps[id] = { state: 'slow', latencyMs };
    }
  });
  s.context.cacheWarm = m[2] === '1';
  s.context.hasSession = m[3] === '1';
  validateScenario(s);
  return s;
}

/** Portable JSON document for download/upload. */
export function toJSON(scenario, name = '') {
  validateScenario(scenario);
  return JSON.stringify({ format: 'outage-lab-scenario', version: 1, name: String(name).slice(0, 100), code: encodeScenario(scenario), scenario: cloneScenario(scenario) }, null, 2);
}

export function fromJSON(text) {
  if (typeof text !== 'string' || text.length > 20000) throw new Error('Scenario file is too large or not text');
  let doc;
  try {
    doc = JSON.parse(text);
  } catch {
    throw new Error('Scenario file is not valid JSON');
  }
  if (!doc || doc.format !== 'outage-lab-scenario' || doc.version !== 1) throw new Error('Not an outage-lab scenario file');
  const s = decodeScenario(doc.code);
  if (doc.scenario !== undefined) {
    const copy = cloneScenario(doc.scenario);
    validateScenario(copy);
    if (encodeScenario(copy) !== doc.code) throw new Error('Scenario file is inconsistent: code and scenario differ');
  }
  return s;
}

/**
 * Random outage. random() must return a float in [0, 1) - pass a seeded generator for reproducible chaos.
 */
export function randomScenario(random = Math.random) {
  const s = baseScenario();
  for (const id of DEPENDENCY_IDS) {
    const r = random();
    if (r < 0.2) s.deps[id] = { state: 'down', latencyMs: 0 };
    else if (r < 0.4) s.deps[id] = { state: 'slow', latencyMs: 200 + Math.floor(random() * 9800) };
  }
  s.context.cacheWarm = random() < 0.75;
  s.context.hasSession = random() < 0.75;
  return s;
}

/** Deterministic PRNG (mulberry32) for reproducible chaos runs. */
export function seededRandom(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
