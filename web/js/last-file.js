// @ts-check
/**
 * The file opened last, kept in the browser (IndexedDB: a profile can be
 * larger than local storage holds), so that reloading the page shows it
 * again, with the interval of its timeline that was in focus: that belongs to the file, and goes
 * when another is kept. A heap dump is kept as its parse, which is a few MB
 * whatever the dump's size and spares parsing it again. Only a convenience:
 * nothing happens when the browser refuses.
 */

const DB = 'mountaingraph', STORE = 'files', KEY = 'last', FOCUS = 'focus';

/** @typedef {import('./load.js').Parse} Parse */

/** @returns {Promise<IDBDatabase>} */
function database() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * @param {IDBTransactionMode} mode
 * @param {(store: IDBObjectStore) => IDBRequest} use
 * @returns {Promise<any>}
 */
async function inStore(mode, use) {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const request = use(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  finally {
    db.close();
  }
}

/**
 * @param {File | Parse} file kept as the last one opened, its interval in focus forgotten: a dump's
 *        parse rather than the dump
 */
export async function keepFile(file) {
  try {
    await inStore('readwrite', store => store.put(file, KEY));
    await inStore('readwrite', store => store.delete(FOCUS));
  }
  catch (e) {
    // only a convenience
  }
}

/** @returns {Promise<File | Parse | null>} the file opened last, or the dump's parse, if kept */
export async function lastFile() {
  try {
    const file = await inStore('readonly', store => store.get(KEY));
    return file instanceof File || file?.doc && typeof file.name === 'string' ? file : null;
  }
  catch (e) {
    return null;
  }
}

/** Forgets the file kept: the page opens empty next time. */
export async function forgetFile() {
  try {
    await inStore('readwrite', store => store.delete(KEY));
    await inStore('readwrite', store => store.delete(FOCUS));
  }
  catch (e) {
    // nothing kept, or nowhere to keep it
  }
}

/**
 * @param {import('./model/timeline.js').Interval | null} interval in focus on the timeline of the file
 *        kept last, none for the whole recording
 */
export async function keepInterval(interval) {
  try {
    await inStore('readwrite', store => interval ? store.put(interval, FOCUS) : store.delete(FOCUS));
  }
  catch (e) {
    // only a convenience
  }
}

/** @returns {Promise<any>} what keepInterval kept, to be checked: null for none */
export async function lastInterval() {
  try {
    return (await inStore('readonly', store => store.get(FOCUS))) ?? null;
  }
  catch (e) {
    return null;
  }
}
