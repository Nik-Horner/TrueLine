// IndexedDB holds recovery revisions, including photos too large for localStorage.
let database;
function db() {
  if (!database) database = new Promise((resolve, reject) => {
    const request = indexedDB.open('trueline-recovery', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('revisions', { keyPath: 'at' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { database = null; reject(request.error); };
  });
  return database;
}
export async function readRevisions() {
  const database = await db();
  return new Promise((resolve, reject) => {
    const tx = database.transaction('revisions', 'readonly'), request = tx.objectStore('revisions').getAll();
    request.onsuccess = () => resolve(request.result.sort((a, b) => b.at - a.at));
    request.onerror = () => reject(request.error);
  });
}
let writes = Promise.resolve();
export function writeRevision(revision) {
  const write = async () => {
    const database = await db();
    return new Promise((resolve, reject) => {
      const tx = database.transaction('revisions', 'readwrite'), store = tx.objectStore('revisions');
      const request = store.getAll();
      request.onsuccess = () => {
        const existing = request.result.sort((a, b) => b.at - a.at);
        // Keep timestamp/state fresh without filling history with identical drawings.
        if (existing[0]?.json === revision.json) { store.delete(existing[0].at); existing.shift(); }
        const keep = [revision, ...existing].sort((a, b) => b.at - a.at);
        let bytes = 0;
        keep.forEach((r, i) => { bytes += r.json.length * 2; if (i >= 12 || (i > 0 && bytes > 64 * 1024 * 1024)) store.delete(r.at); });
        store.put(revision);
      };
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Recovery write aborted'));
    });
  };
  writes = writes.catch(() => {}).then(write);
  return writes;
}

export async function clearOlderRevisions() {
  const database = await db();
  return new Promise((resolve, reject) => {
    const tx = database.transaction('revisions', 'readwrite'), store = tx.objectStore('revisions');
    const request = store.getAll();
    request.onsuccess = () => {
      const latest = request.result.sort((a, b) => b.at - a.at)[0];
      store.clear(); if (latest) store.put(latest);
    };
    tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
  });
}
