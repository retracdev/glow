/*
 * Keeps a photo that hasn't been saved yet while the visitor is away at the guided sign-in
 * page, so it can be saved once they're back. It lives in IndexedDB, which holds a Blob as it
 * is, and is handed back (and removed) once. Anything going wrong here just means no photo.
 */

const DB_NAME = 'glow-sign-in';
const STORE = 'photos';
const KEY = 'pending';
// Older than this, and the visitor most likely never finished signing in that time.
const MAX_AGE_MS = 60 * 60 * 1000;
const TIMEOUT_MS = 3000;

interface StashedPhoto {
  blob: Blob;
  takenAt: number;
  stashedAt: number;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('blocked'));
  });
}

function withTimeout<T>(promise: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = work(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/** Resolves true once the photo is safely stored. */
export async function stashPhoto(blob: Blob, takenAt: number): Promise<boolean> {
  try {
    const entry: StashedPhoto = { blob, takenAt, stashedAt: Date.now() };
    await withTimeout(run('readwrite', (store) => store.put(entry, KEY)));
    return true;
  } catch {
    return false;
  }
}

/** The stashed photo, if there's a recent one. Either way, nothing is left behind. */
export async function takeStashedPhoto(): Promise<{ blob: Blob; takenAt: number } | null> {
  try {
    const entry = await withTimeout(run<StashedPhoto | undefined>('readonly', (store) => store.get(KEY)));
    if (entry) await withTimeout(run('readwrite', (store) => store.delete(KEY)));
    if (!entry || !(entry.blob instanceof Blob) || Date.now() - entry.stashedAt > MAX_AGE_MS) return null;
    return { blob: entry.blob, takenAt: entry.takenAt };
  } catch {
    return null;
  }
}
