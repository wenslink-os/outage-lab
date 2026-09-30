import { DEPENDENCIES, DEPENDENCY_IDS, NETWORK_PREREQUISITES, DEP_STATES, MAX_LATENCY_MS } from './dependencies.js';
import { FEATURES, FALLBACKS, MODES } from './features.js';

export const DEFAULT_TIMEOUT_MS = 3000;
const STATUS_WEIGHT = Object.freeze({ working: 1, degraded: 0.5, broken: 0 });

/**
 * Effective reachability of every dependency after applying network prerequisites.
 * Returns { [depId]: { state: 'up'|'slow'|'timeout'|'down', latencyMs, cause } }.
 * cause is the dependency responsible for a slow, timeout or down state.
 */
export function effectiveStatus(scenario, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const deps = scenario.deps;
  const result = {};
  for (const dep of DEPENDENCIES) {
    const chain = dep.kind === 'remote' ? [...NETWORK_PREREQUISITES, dep.id] : [dep.id];
    const downDep = chain.find((id) => deps[id].state === 'down');
    if (downDep) {
      result[dep.id] = { state: 'down', latencyMs: 0, cause: downDep };
      continue;
    }
    let latencyMs = 0;
    let slowest = null;
    for (const id of chain) {
      if (deps[id].state === 'slow') {
        latencyMs += deps[id].latencyMs;
        if (slowest === null || deps[id].latencyMs > deps[slowest].latencyMs) slowest = id;
      }
    }
    if (latencyMs > timeoutMs) result[dep.id] = { state: 'timeout', latencyMs, cause: slowest };
    else if (latencyMs > 0) result[dep.id] = { state: 'slow', latencyMs, cause: slowest };
    else result[dep.id] = { state: 'up', latencyMs: 0, cause: null };
  }
  return result;
}

/**
 * Evaluate one feature in one mode.
 * Returns { status: 'working'|'degraded'|'broken', reasons: [{ dep, state, cause, outcome, fallback }] }.
 * outcome: 'slow' (still works), 'fallback' (degraded), 'hang' (fragile has no timeout), 'fail'.
 */
export function evaluateFeature(feature, mode, scenario, effective, timeoutMs = DEFAULT_TIMEOUT_MS) {
  if (!MODES.includes(mode)) throw new Error(`Unknown mode: ${mode}`);
  const spec = feature[mode];
  const eff = effective || effectiveStatus(scenario, timeoutMs);
  const reasons = [];
  let status = 'working';
  for (const dep of spec.requires) {
    const e = eff[dep];
    if (e.state === 'up') continue;
    if (e.state === 'slow') {
      reasons.push({ dep, state: e.state, cause: e.cause, outcome: 'slow', fallback: null });
      continue;
    }
    if (mode === 'fragile') {
      reasons.push({ dep, state: e.state, cause: e.cause, outcome: e.state === 'timeout' ? 'hang' : 'fail', fallback: null });
      status = 'broken';
      continue;
    }
    const fbId = spec.fallbacks ? spec.fallbacks[dep] : undefined;
    const fb = fbId ? FALLBACKS[fbId] : null;
    if (fb && (fb.needs === null || scenario.context[fb.needs] === true)) {
      reasons.push({ dep, state: e.state, cause: e.cause, outcome: 'fallback', fallback: fbId });
      if (status === 'working') status = 'degraded';
    } else {
      reasons.push({ dep, state: e.state, cause: e.cause, outcome: 'fail', fallback: fbId || null });
      status = 'broken';
    }
  }
  return { status, reasons };
}

/** Evaluate every feature in both modes. */
export function evaluate(scenario, timeoutMs = DEFAULT_TIMEOUT_MS) {
  validateScenario(scenario);
  const effective = effectiveStatus(scenario, timeoutMs);
  const features = {};
  for (const feature of FEATURES) {
    features[feature.id] = {
      fragile: evaluateFeature(feature, 'fragile', scenario, effective, timeoutMs),
      resilient: evaluateFeature(feature, 'resilient', scenario, effective, timeoutMs)
    };
  }
  return {
    effective,
    features,
    score: {
      fragile: scoreFor(features, 'fragile'),
      resilient: scoreFor(features, 'resilient')
    }
  };
}

function scoreFor(features, mode) {
  const ids = Object.keys(features);
  const total = ids.reduce((sum, id) => sum + STATUS_WEIGHT[features[id][mode].status], 0);
  return Math.round((total / ids.length) * 100);
}

/** Average score over a list of scenarios: one number per design. */
export function suiteScore(scenarios, timeoutMs = DEFAULT_TIMEOUT_MS) {
  if (!Array.isArray(scenarios) || scenarios.length === 0) throw new Error('suiteScore needs at least one scenario');
  const sums = { fragile: 0, resilient: 0 };
  for (const s of scenarios) {
    const r = evaluate(s, timeoutMs);
    sums.fragile += r.score.fragile;
    sums.resilient += r.score.resilient;
  }
  return {
    fragile: Math.round(sums.fragile / scenarios.length),
    resilient: Math.round(sums.resilient / scenarios.length)
  };
}

/** Features that call a dependency in a given mode. Used by the dependency graph. */
export function dependents(depId, mode) {
  if (!MODES.includes(mode)) throw new Error(`Unknown mode: ${mode}`);
  return FEATURES.filter((f) => f[mode].requires.includes(depId)).map((f) => f.id);
}

export function validateScenario(scenario) {
  if (!scenario || typeof scenario !== 'object') throw new Error('Scenario must be an object');
  if (!scenario.deps || typeof scenario.deps !== 'object') throw new Error('Scenario.deps is missing');
  for (const id of DEPENDENCY_IDS) {
    const d = scenario.deps[id];
    if (!d || !DEP_STATES.includes(d.state)) throw new Error(`Invalid state for ${id}`);
    if (!Number.isFinite(d.latencyMs) || d.latencyMs < 0 || d.latencyMs > MAX_LATENCY_MS) {
      throw new Error(`Invalid latency for ${id}`);
    }
  }
  const ctx = scenario.context;
  if (!ctx || typeof ctx.cacheWarm !== 'boolean' || typeof ctx.hasSession !== 'boolean') {
    throw new Error('Scenario.context must have boolean cacheWarm and hasSession');
  }
  return true;
}
