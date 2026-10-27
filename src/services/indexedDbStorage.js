/**
 * KRAFTSTOFF - Lokale persistente IndexedDB-Speicherschicht
 *
 * Generischer Key/Value-Store. Überlebt das Leeren des normalen Browser-Caches
 * und trägt den Tankerkönig API-Key, die Preishistorie und das KI-Modell.
 */

const DB_NAME = 'kraftstoff_persistent_storage';
const DB_VERSION = 1;
const STORE_NAME = 'database_store';

let dbPromise = null;

function openDatabase() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      dbPromise = null;
      return reject(new Error('IndexedDB in dieser Umgebung nicht verfügbar'));
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = (event) => {
      const db = event.target.result;
      // Bei externem Schließen (z.B. Versionswechsel in anderem Tab) neu verbinden
      db.onclose = () => { dbPromise = null; };
      db.onversionchange = () => { try { db.close(); } catch {} dbPromise = null; };
      resolve(db);
    };
    request.onerror = (event) => {
      dbPromise = null;
      reject(event.target.error);
    };
  });
  return dbPromise;
}

function runRequest(mode, fn) {
  return openDatabase().then(
    (db) =>
      new Promise((resolve) => {
        try {
          const tx = db.transaction(STORE_NAME, mode);
          const store = tx.objectStore(STORE_NAME);
          const req = fn(store);
          req.onsuccess = () => resolve(req.result ?? null);
          req.onerror = () => resolve(null);
        } catch {
          resolve(null);
        }
      }),
    () => null
  );
}

/** Liest einen Wert anhand seines Schlüssels aus IndexedDB. */
export async function idbGet(key) {
  return runRequest('readonly', (store) => store.get(key));
}

/** Schreibt einen Wert anhand seines Schlüssels in IndexedDB. */
export async function idbSet(key, value) {
  const res = await runRequest('readwrite', (store) => store.put(value, key));
  return res !== null;
}

/** Entfernt einen Schlüssel aus IndexedDB. */
export async function idbDelete(key) {
  const res = await runRequest('readwrite', (store) => store.delete(key));
  return res !== null;
}

/**
 * Liest alle Einträge, deren Schlüssel mit dem Präfix beginnt.
 * Gibt ein Array von { key, value } zurück.
 */
export async function idbGetAllWithPrefix(prefix) {
  try {
    const db = await openDatabase();
    return await new Promise((resolve) => {
      const results = [];
      try {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const range = IDBKeyRange.bound(prefix, prefix + '￿');
        const req = store.openCursor(range);
        req.onsuccess = () => {
          const cursor = req.result;
          if (cursor) {
            results.push({ key: cursor.key, value: cursor.value });
            cursor.continue();
          } else {
            resolve(results);
          }
        };
        req.onerror = () => resolve(results);
      } catch {
        resolve(results);
      }
    });
  } catch {
    return [];
  }
}

/** Schreibt mehrere Schlüssel in einer Transaktion. entries: Array<[key, value]> */
export async function idbSetMany(entries) {
  if (!entries || entries.length === 0) return true;
  try {
    const db = await openDatabase();
    return await new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        entries.forEach(([key, value]) => store.put(value, key));
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
        tx.onabort = () => resolve(false);
      } catch {
        resolve(false);
      }
    });
  } catch {
    return false;
  }
}
