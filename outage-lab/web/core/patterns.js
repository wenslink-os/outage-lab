// Small, dependency-free resilience patterns. Every time source is injectable so tests stay deterministic.

export class TimeoutError extends Error {
  constructor(ms) {
    super(`Timed out after ${ms} ms`);
    this.name = 'TimeoutError';
    this.code = 'TIMEOUT';
  }
}

export class CircuitOpenError extends Error {
  constructor(name) {
    super(`Circuit for ${name} is open; call skipped`);
    this.name = 'CircuitOpenError';
    this.code = 'CIRCUIT_OPEN';
  }
}

/**
 * Race fn() against a timer. clock.sleep(ms) must return a promise.
 * The losing promise is left to settle on its own; its result is ignored.
 */
export async function withTimeout(fn, ms, clock) {
  if (!(Number.isFinite(ms) && ms > 0)) throw new Error('withTimeout needs a positive ms');
  let timedOut = false;
  const timer = clock.sleep(ms).then(() => {
    timedOut = true;
    throw new TimeoutError(ms);
  });
  const work = Promise.resolve().then(fn);
  work.catch(() => {});
  timer.catch(() => {});
  const result = await Promise.race([work, timer]);
  if (timedOut) throw new TimeoutError(ms);
  return result;
}

/**
 * Retry with exponential backoff and optional full jitter.
 * shouldRetry(err) decides whether an error is worth another attempt.
 * onRetry({ attempt, delayMs, error }) is called before each wait.
 */
export async function retry(fn, options = {}) {
  const {
    retries = 2,
    baseMs = 200,
    factor = 2,
    maxMs = 2000,
    jitter = false,
    random = Math.random,
    clock,
    shouldRetry = () => true,
    onRetry = () => {}
  } = options;
  if (!clock) throw new Error('retry needs a clock');
  if (!(Number.isInteger(retries) && retries >= 0)) throw new Error('retries must be a non-negative integer');
  let attempt = 0;
  for (;;) {
    try {
      return await fn(attempt);
    } catch (error) {
      if (attempt >= retries || !shouldRetry(error)) throw error;
      const exp = Math.min(maxMs, baseMs * Math.pow(factor, attempt));
      const delayMs = jitter ? Math.floor(random() * exp) : exp;
      attempt += 1;
      onRetry({ attempt, delayMs, error });
      await clock.sleep(delayMs);
    }
  }
}

/**
 * Classic three-state circuit breaker.
 * closed    -> calls pass; failureThreshold consecutive failures open it.
 * open      -> calls fail fast until cooldownMs has passed.
 * half-open -> one trial call; success closes, failure re-opens.
 */
export class CircuitBreaker {
  constructor({ name, failureThreshold = 3, cooldownMs = 5000, now }) {
    if (typeof now !== 'function') throw new Error('CircuitBreaker needs a now() function');
    this.name = name;
    this.failureThreshold = failureThreshold;
    this.cooldownMs = cooldownMs;
    this.now = now;
    this.state = 'closed';
    this.failures = 0;
    this.openedAt = 0;
    this.listeners = [];
  }

  onChange(listener) {
    this.listeners.push(listener);
  }

  setState(next) {
    if (next === this.state) return;
    const prev = this.state;
    this.state = next;
    for (const l of this.listeners) l({ name: this.name, from: prev, to: next });
  }

  currentState() {
    if (this.state === 'open' && this.now() - this.openedAt >= this.cooldownMs) this.setState('half-open');
    return this.state;
  }

  async call(fn) {
    const state = this.currentState();
    if (state === 'open') throw new CircuitOpenError(this.name);
    try {
      const result = await fn();
      this.failures = 0;
      this.setState('closed');
      return result;
    } catch (error) {
      this.failures += 1;
      if (state === 'half-open' || this.failures >= this.failureThreshold) {
        this.openedAt = this.now();
        this.setState('open');
      }
      throw error;
    }
  }
}

/**
 * Durable FIFO queue of pending work, persisted through a store (see store.js).
 * flush(handler) runs handler(item) in order and stops at the first failure,
 * so later items never overtake an earlier one.
 */
export class OfflineQueue {
  constructor(store, key = 'queue') {
    this.store = store;
    this.key = key;
  }

  async items() {
    const v = await this.store.get(this.key);
    return Array.isArray(v) ? v : [];
  }

  async enqueue(type, payload, id) {
    const list = await this.items();
    const item = { id: id || `${type}-${list.length + 1}-${Math.random().toString(36).slice(2, 8)}`, type, payload, attempts: 0 };
    list.push(item);
    await this.store.set(this.key, list);
    return item;
  }

  async size() {
    return (await this.items()).length;
  }

  async flush(handler) {
    const list = await this.items();
    const done = [];
    let failed = null;
    while (list.length > 0) {
      const item = list[0];
      try {
        await handler(item);
        done.push(item);
        list.shift();
      } catch (error) {
        item.attempts += 1;
        failed = { item, error };
        break;
      }
    }
    await this.store.set(this.key, list);
    return { done, remaining: list.length, failed };
  }

  async clear() {
    await this.store.set(this.key, []);
  }
}
