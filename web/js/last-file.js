// @ts-check
/**
 * The profile opened last, kept in the browser (IndexedDB: a profile can be
 * larger than local storage holds), so that reloading the page shows it
 * again. Only a convenience: nothing happens when the browser refuses.
 */

const DB = 'mountaingraph', STORE = 'files', KEY = 'last';

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

/** @param {File} file kept as the last one opened */
export async function keepFile(file) {
  try {
    await inStore('readwrite', store => store.put(file, KEY));
  }
  catch (e) {
    // only a convenience
  }
}

/** @returns {Promise<File | null>} the file opened last, if kept */
export async function lastFile() {
  try {
    const file = await inStore('readonly', store => store.get(KEY));
    return file instanceof File ? file : null;
  }
  catch (e) {
    return null;
  }
}
