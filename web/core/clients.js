// Two real implementations of the same shopping journey against the simulated services.
// fragile:   calls every service directly, no timeout, no cache, no queue.
// resilient: timeout + retry + circuit breaker per service, local cache, cached session, offline queue.

import { FEATURE_IDS } from './features.js';
import { withTimeout, retry, CircuitBreaker, OfflineQueue } from './patterns.js';
import { PRODUCTS } from './services.js';
import { DEFAULT_TIMEOUT_MS } from './engine.js';

export const JOURNEY = FEATURE_IDS;
const ORDER_ID = 'order-1';
const CART_ITEM = 'tea';
const SEARCH_QUERY = 'tea';

function describe(error) {
  return error && error.message ? error.message : String(error);
}

function stepRunner(mode, clock, onEvent) {
  return async function runStep(feature, body) {
    const started = clock.now();
    const notes = [];
    const note = (kind, detail) => {
      notes.push({ kind, detail });
      onEvent({ mode, feature, kind, detail, at: Math.round(clock.now()) });
    };
    let outcome;
    try {
      outcome = await body(note);
    } catch (error) {
      note('error', describe(error));
      outcome = { status: 'broken' };
    }
    const step = { mode, feature, status: outcome.status, elapsedMs: Math.round(clock.now() - started), notes };
    onEvent({ mode, feature, kind: 'result', detail: step.status, at: Math.round(clock.now()), step });
    return step;
  };
}

export function createFragileClient({ services, clock, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  let token = null;

  // No timeout: the call always waits. A wait longer than timeoutMs is recorded as a frozen UI.
  async function call(label, fn, note, flags) {
    const t0 = clock.now();
    const result = await fn();
    const waited = clock.now() - t0;
    if (waited > timeoutMs) {
      flags.hung = true;
      note('hang', `${label} took ${Math.round(waited)} ms with no timeout; the screen froze`);
    } else {
      note('call', `${label} ok (${Math.round(waited)} ms)`);
    }
    return result;
  }

  const steps = {
    async login(note, flags) {
      const r = await call('auth.login', () => services.auth.login(), note, flags);
      token = r.token;
    },
    async catalog(note, flags) {
      await call('auth.verify', () => services.auth.verify(token), note, flags);
      await call('backend.getCatalog', () => services.backend.getCatalog(), note, flags);
    },
    async images(note, flags) {
      await call('cdn.image', () => services.cdn.image(PRODUCTS[0].id), note, flags);
    },
    async search(note, flags) {
      await call('auth.verify', () => services.auth.verify(token), note, flags);
      await call('backend.search', () => services.backend.search(SEARCH_QUERY), note, flags);
    },
    async cart(note, flags) {
      await call('auth.verify', () => services.auth.verify(token), note, flags);
      await call('backend.addToCart', () => services.backend.addToCart(CART_ITEM), note, flags);
    },
    async checkout(note, flags) {
      const total = PRODUCTS.find((p) => p.id === CART_ITEM).price;
      await call('auth.verify', () => services.auth.verify(token), note, flags);
      await call('backend.createOrder', () => services.backend.createOrder({ orderId: ORDER_ID, items: [CART_ITEM], total }), note, flags);
      await call('payment.charge', () => services.payment.charge({ orderId: ORDER_ID, amount: total }), note, flags);
      await call('email.send', () => services.email.send({ to: 'shopper@example.test', subject: `Order ${ORDER_ID}` }), note, flags);
    },
    async receipt(note, flags) {
      await call('email.send', () => services.email.send({ to: 'shopper@example.test', subject: `Receipt ${ORDER_ID}` }), note, flags);
    },
    async export(note, flags) {
      await call('auth.verify', () => services.auth.verify(token), note, flags);
      await call('backend.exportData', () => services.backend.exportData(), note, flags);
    }
  };

  return {
    mode: 'fragile',
    async runJourney(onEvent = () => {}) {
      const runStep = stepRunner('fragile', clock, onEvent);
      const results = [];
      for (const feature of JOURNEY) {
        results.push(
          await runStep(feature, async (note) => {
            const flags = { hung: false };
            await steps[feature](note, flags);
            return { status: flags.hung ? 'broken' : 'working' };
          })
        );
      }
      return results;
    }
  };
}

export function createResilientClient({ services, clock, store, timeoutMs = DEFAULT_TIMEOUT_MS, retries = 2, onBreaker = () => {} }) {
  const queue = new OfflineQueue(store, 'queue');
  const breakers = {};
  for (const dep of ['auth', 'backend', 'payment', 'email', 'cdn']) {
    const b = new CircuitBreaker({ name: dep, failureThreshold: 3, cooldownMs: 5000, now: () => clock.now() });
    b.onChange(onBreaker);
    breakers[dep] = b;
  }

  // timeout -> circuit breaker -> retry (only for idempotent operations)
  function guard(dep, label, fn, note, { idempotent }) {
    return retry(() => breakers[dep].call(() => withTimeout(fn, timeoutMs, clock)), {
      retries: idempotent ? retries : 0,
      baseMs: 200,
      factor: 2,
      maxMs: 1600,
      clock,
      shouldRetry: (e) => e.code !== 'CIRCUIT_OPEN' && e.code !== 'UNAUTHORIZED',
      onRetry: ({ attempt, delayMs, error }) => note('retry', `${label} attempt ${attempt + 1} in ${delayMs} ms after: ${describe(error)}`)
    }).then(
      (r) => {
        note('call', `${label} ok`);
        return r;
      },
      (e) => {
        note(e.code === 'CIRCUIT_OPEN' ? 'breaker' : 'error', `${label} failed: ${describe(e)}`);
        throw e;
      }
    );
  }

  async function checkoutRemote(item, note) {
    if (item.payload.needsOrder) {
      await guard('backend', 'backend.createOrder', () => services.backend.createOrder(item.payload), note, { idempotent: true });
    }
    await guard('payment', 'payment.charge', () => services.payment.charge({ orderId: item.payload.orderId, amount: item.payload.total }), note, { idempotent: true });
  }

  const steps = {
    async login(note) {
      try {
        const r = await guard('auth', 'auth.login', () => services.auth.login(), note, { idempotent: true });
        await store.set('session', { token: r.token, user: r.user });
        return 'working';
      } catch {
        const session = await store.get('session');
        if (session) {
          note('fallback', 'Using the saved session; signing in as someone new is unavailable');
          return 'degraded';
        }
        note('error', 'No saved session, so sign-in is impossible');
        return 'broken';
      }
    },
    async catalog(note) {
      try {
        const items = await guard('backend', 'backend.getCatalog', () => services.backend.getCatalog(), note, { idempotent: true });
        await store.set('catalog', items);
        return 'working';
      } catch {
        const cached = await store.get('catalog');
        if (cached) {
          note('fallback', `Showing ${cached.length} products from the local cache (may be stale)`);
          return 'degraded';
        }
        note('error', 'No cached catalogue on this device');
        return 'broken';
      }
    },
    async images(note) {
      try {
        await guard('cdn', 'cdn.image', () => services.cdn.image(PRODUCTS[0].id), note, { idempotent: true });
        return 'working';
      } catch {
        note('fallback', 'Showing text placeholders instead of product photos');
        return 'degraded';
      }
    },
    async search(note) {
      try {
        await guard('backend', 'backend.search', () => services.backend.search(SEARCH_QUERY), note, { idempotent: true });
        return 'working';
      } catch {
        const cached = await store.get('catalog');
        if (cached) {
          const hits = cached.filter((p) => p.name.toLowerCase().includes(SEARCH_QUERY));
          note('fallback', `Searched the cached catalogue on the device: ${hits.length} result(s)`);
          return 'degraded';
        }
        note('error', 'Nothing cached to search locally');
        return 'broken';
      }
    },
    async cart(note) {
      const cart = (await store.get('cart')) || [];
      cart.push(CART_ITEM);
      await store.set('cart', cart);
      note('call', `Cart saved on the device (${cart.length} item(s)); no network needed`);
      return 'working';
    },
    async checkout(note) {
      const session = await store.get('session');
      let status = 'working';
      try {
        if (!session) throw new Error('no session');
        await guard('auth', 'auth.verify', () => services.auth.verify(session.token), note, { idempotent: true });
      } catch {
        if (!session) {
          note('error', 'Not signed in and no saved session, so checkout cannot identify the buyer');
          return 'broken';
        }
        note('fallback', 'Identity taken from the saved session');
        status = 'degraded';
      }
      const total = PRODUCTS.find((p) => p.id === CART_ITEM).price;
      const item = { id: ORDER_ID, type: 'checkout', payload: { orderId: ORDER_ID, items: [CART_ITEM], total, needsOrder: true } };
      try {
        await guard('backend', 'backend.createOrder', () => services.backend.createOrder(item.payload), note, { idempotent: true });
        item.payload.needsOrder = false;
        await checkoutRemote(item, note);
        return status;
      } catch {
        await queue.enqueue('checkout', item.payload, ORDER_ID);
        note('fallback', 'Order saved to the offline queue; it will be submitted and paid when services return');
        return 'degraded';
      }
    },
    async receipt(note) {
      const mail = { to: 'shopper@example.test', subject: `Receipt ${ORDER_ID}` };
      try {
        await guard('email', 'email.send', () => services.email.send(mail), note, { idempotent: false });
        return 'working';
      } catch {
        await queue.enqueue('email', mail, `email-${ORDER_ID}`);
        note('fallback', 'Receipt queued; it will be emailed later');
        return 'degraded';
      }
    },
    async export(note) {
      const keys = await store.keys();
      const data = {};
      for (const k of keys) data[k] = await store.get(k);
      const bytes = JSON.stringify(data).length;
      note('call', `Exported ${keys.length} local record(s), ${bytes} bytes, straight from the device`);
      return 'working';
    }
  };

  return {
    mode: 'resilient',
    queue,
    breakers,
    /** Seed device state to match scenario.context (a returning user vs a first launch). */
    async seed({ cacheWarm, hasSession }) {
      await store.clear();
      if (cacheWarm) await store.set('catalog', PRODUCTS.map((p) => ({ ...p })));
      if (hasSession) await store.set('session', { token: 'cached-token', user: { id: 'u1', name: 'Demo shopper' } });
    },
    async runJourney(onEvent = () => {}) {
      const runStep = stepRunner('resilient', clock, onEvent);
      const results = [];
      for (const feature of JOURNEY) {
        results.push(await runStep(feature, async (note) => ({ status: await steps[feature](note) })));
      }
      return results;
    },
    /** Replay queued work in order; stops at the first item that still fails. */
    async flushQueue(onEvent = () => {}) {
      const note = (kind, detail) => onEvent({ mode: 'resilient', feature: 'queue', kind, detail, at: Math.round(clock.now()) });
      return queue.flush(async (item) => {
        if (item.type === 'checkout') await checkoutRemote(item, note);
        else if (item.type === 'email') await guard('email', 'email.send', () => services.email.send(item.payload), note, { idempotent: false });
        else throw new Error(`Unknown queue item type: ${item.type}`);
      });
    },
    async exportData() {
      const keys = await store.keys();
      const data = {};
      for (const k of keys) data[k] = await store.get(k);
      return data;
    }
  };
}
