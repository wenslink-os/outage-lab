// Simulated external services. Nothing here touches a real network:
// each call reads the current scenario, waits the simulated latency, then succeeds or fails.

import { effectiveStatus } from './engine.js';

export const PRODUCTS = Object.freeze([
  { id: 'tea', name: 'Assam tea, 250 g', price: 240 },
  { id: 'gamosa', name: 'Handwoven gamosa', price: 350 },
  { id: 'muga', name: 'Muga silk stole', price: 2800 },
  { id: 'lamp', name: 'Bamboo table lamp', price: 950 },
  { id: 'honey', name: 'Forest honey, 500 g', price: 420 },
  { id: 'jaapi', name: 'Miniature jaapi', price: 180 }
]);

export class ServiceError extends Error {
  constructor(dep, cause) {
    const what = cause === dep ? `${dep} is down` : `${dep} unreachable because ${cause} is down`;
    super(what);
    this.name = 'ServiceError';
    this.code = cause === dep ? 'SERVICE_DOWN' : 'NETWORK_UNREACHABLE';
    this.dep = dep;
    this.cause = cause;
  }
}

export class AuthError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AuthError';
    this.code = 'UNAUTHORIZED';
  }
}

/**
 * getScenario() returns the scenario at call time, so switches flipped mid-journey take effect.
 * clock provides sleep(ms) in logical milliseconds.
 */
export function createServices({ getScenario, clock, baseLatencyMs = 30 }) {
  if (typeof getScenario !== 'function') throw new Error('createServices needs getScenario()');
  if (!clock) throw new Error('createServices needs a clock');
  const ledger = new Map();
  const orders = new Map();
  const outbox = [];
  const validTokens = new Set(['cached-token']);
  const serverCart = [];
  let tokenSeq = 0;
  const stats = { calls: 0, failures: 0 };

  async function reach(dep) {
    stats.calls += 1;
    const eff = effectiveStatus(getScenario(), Number.POSITIVE_INFINITY)[dep];
    if (eff.state === 'down') {
      stats.failures += 1;
      throw new ServiceError(dep, eff.cause);
    }
    await clock.sleep(baseLatencyMs + eff.latencyMs);
  }

  function requireToken(token) {
    if (!token || !validTokens.has(token)) throw new AuthError('Session token is missing or invalid');
  }

  return {
    stats,
    ledger,
    orders,
    outbox,
    auth: {
      async login() {
        await reach('auth');
        tokenSeq += 1;
        const token = `token-${tokenSeq}`;
        validTokens.add(token);
        return { token, user: { id: 'u1', name: 'Demo shopper' } };
      },
      async verify(token) {
        await reach('auth');
        requireToken(token);
        return { valid: true };
      }
    },
    backend: {
      async getCatalog() {
        await reach('backend');
        return PRODUCTS.map((p) => ({ ...p }));
      },
      async search(query) {
        await reach('backend');
        const q = String(query).toLowerCase();
        return PRODUCTS.filter((p) => p.name.toLowerCase().includes(q)).map((p) => ({ ...p }));
      },
      async addToCart(productId) {
        await reach('backend');
        serverCart.push(productId);
        return { items: [...serverCart] };
      },
      async createOrder({ orderId, items, total }) {
        await reach('backend');
        if (!orders.has(orderId)) orders.set(orderId, { orderId, items: [...items], total });
        return { orderId, status: 'created' };
      },
      async exportData() {
        await reach('backend');
        return { orders: [...orders.values()] };
      }
    },
    payment: {
      // Idempotent by orderId: retrying the same order never charges twice.
      async charge({ orderId, amount }) {
        await reach('payment');
        if (!ledger.has(orderId)) ledger.set(orderId, { orderId, amount, chargeId: `ch-${ledger.size + 1}` });
        return { ...ledger.get(orderId) };
      }
    },
    email: {
      async send({ to, subject }) {
        await reach('email');
        outbox.push({ to, subject });
        return { queued: false, messageId: `m-${outbox.length}` };
      }
    },
    cdn: {
      async image(productId) {
        await reach('cdn');
        return { productId, url: `simulated://cdn/${productId}.webp` };
      }
    }
  };
}
