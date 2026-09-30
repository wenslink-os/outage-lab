// Features of the "Mini Store" sample app, declared twice:
// once as a fragile (cloud-coupled) design and once as a resilient (local-first) design.
// requires  = dependencies the feature calls.
// fallbacks = what the resilient design does when a required dependency is unavailable.
// A fallback's "needs" names a scenario.context flag that must be true for it to work.

export const FALLBACKS = Object.freeze({
  cache: { needs: 'cacheWarm' },
  localSearch: { needs: 'cacheWarm' },
  session: { needs: 'hasSession' },
  queue: { needs: null },
  placeholder: { needs: null }
});

export const FEATURES = Object.freeze([
  {
    id: 'login',
    fragile: { requires: ['auth'] },
    resilient: { requires: ['auth'], fallbacks: { auth: 'session' } }
  },
  {
    id: 'catalog',
    fragile: { requires: ['backend', 'auth'] },
    resilient: { requires: ['backend'], fallbacks: { backend: 'cache' } }
  },
  {
    id: 'images',
    fragile: { requires: ['cdn'] },
    resilient: { requires: ['cdn'], fallbacks: { cdn: 'placeholder' } }
  },
  {
    id: 'search',
    fragile: { requires: ['backend', 'auth'] },
    resilient: { requires: ['backend'], fallbacks: { backend: 'localSearch' } }
  },
  {
    id: 'cart',
    fragile: { requires: ['backend', 'auth'] },
    resilient: { requires: [] }
  },
  {
    id: 'checkout',
    fragile: { requires: ['auth', 'backend', 'payment', 'email'] },
    resilient: {
      requires: ['auth', 'backend', 'payment'],
      fallbacks: { auth: 'session', backend: 'queue', payment: 'queue' }
    }
  },
  {
    id: 'receipt',
    fragile: { requires: ['email'] },
    resilient: { requires: ['email'], fallbacks: { email: 'queue' } }
  },
  {
    id: 'export',
    fragile: { requires: ['backend', 'auth'] },
    resilient: { requires: [] }
  }
]);

export const FEATURE_IDS = Object.freeze(FEATURES.map((f) => f.id));
export const MODES = Object.freeze(['fragile', 'resilient']);
