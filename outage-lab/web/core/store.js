// Async key-value store. Both backends expose get/set/delete/keys/clear and deep-copy values,
// so callers can never mutate stored data by accident.

const copy = (v) => (v === undefined ? undefined : structuredClone(v));

export function createMemoryStore() {
  const map = new Map();
  return {
    kind: 'memory',
    async get(key) {
      return copy(map.get(key));
    },
    async set(key, value) {
      map.set(key, copy(value));
    },
    async delete(key) {
      map.delete(key);
    },
    async keys() {
      return [...map.keys()].sort();
    },
    async clear() {
      map.clear();
    }
  };
}

function promisify(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB request failed'));
  });
}

/**
 * IndexedDB-backed store. Pass the factory explicitly (window.indexedDB in browsers).
 * Rejects if IndexedDB is unavailable or blocked, so callers can fall back to memory.
 */
export async function createIndexedDBStore({ indexedDB, dbName = 'outage-lab', storeName = 'kv' } = {}) {
  if (!indexedDB || typeof indexedDB.open !== 'function') throw new Error('IndexedDB is not available');
  const db = await new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(storeName)) req.result.createObjectStore(storeName);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Could not open IndexedDB'));
    req.onblocked = () => reject(new Error('IndexedDB open was blocked'));
  });

  const tx = (mode, work) =>
    new Promise((resolve, reject) => {
      const t = db.transaction(storeName, mode);
      const os = t.objectStore(storeName);
      let result;
      Promise.resolve(work(os))
        .then((r) => {
          result = r;
        })
        .catch(reject);
      t.oncomplete = () => resolve(result);
      t.onerror = () => reject(t.error || new Error('IndexedDB transaction failed'));
      t.onabort = () => reject(t.error || new Error('IndexedDB transaction aborted'));
    });

  return {
    kind: 'indexeddb',
    async get(key) {
      return copy(await tx('readonly', (os) => promisify(os.get(key))));
    },
    async set(key, value) {
      await tx('readwrite', (os) => promisify(os.put(copy(value), key)));
    },
    async delete(key) {
      await tx('readwrite', (os) => promisify(os.delete(key)));
    },
    async keys() {
      const keys = await tx('readonly', (os) => promisify(os.getAllKeys()));
      return keys.map(String).sort();
    },
    async clear() {
      await tx('readwrite', (os) => promisify(os.clear()));
    },
    close() {
      db.close();
    }
  };
}

/** Prefer IndexedDB, fall back to memory. Returns { store, persistent, reason }. */
export async function openBestStore(indexedDB) {
  try {
    const store = await createIndexedDBStore({ indexedDB });
    return { store, persistent: true, reason: null };
  } catch (error) {
    return { store: createMemoryStore(), persistent: false, reason: error.message };
  }
}
