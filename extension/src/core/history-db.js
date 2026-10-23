// Practice history storage: IndexedDB in the extension's own origin, so the
// Songsterr page and the standalone player share it and clearing Songsterr's
// site data doesn't delete it. Used directly by extension pages and by the
// background service worker (which serves content scripts, see history.js).

const DB_NAME = 'bass-trainer';
const STORE = 'passes';
const MAX_PER_SONG = 500;

let dbPromise = null;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const store = req.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
        store.createIndex('song', 'songKey');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => { dbPromise = null; reject(req.error); };
    });
  }
  return dbPromise;
}

function done(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function store(mode) {
  return (await open()).transaction(STORE, mode).objectStore(STORE);
}

export const idbHistory = {
  async add(record) {
    const id = await done((await store('readwrite')).add(record));
    // Keep the newest MAX_PER_SONG passes per song.
    const all = await this.list(record.songKey);
    if (all.length > MAX_PER_SONG) {
      const s = await store('readwrite');
      for (const r of all.slice(0, all.length - MAX_PER_SONG)) s.delete(r.id);
    }
    return id;
  },
  async list(songKey) {
    const recs = await done((await store('readonly')).index('song').getAll(songKey));
    return recs.sort((a, b) => a.at - b.at);
  },
  async clear(songKey) {
    const s = await store('readwrite');
    const keys = await done(s.index('song').getAllKeys(songKey));
    for (const k of keys) s.delete(k);
    return keys.length;
  },
  async songs() {
    const recs = await done((await store('readonly')).getAll());
    const map = new Map();
    for (const r of recs) {
      const e = map.get(r.songKey) || { songKey: r.songKey, title: r.title, artist: r.artist, passes: 0, last: 0 };
      e.passes++;
      e.last = Math.max(e.last, r.at);
      map.set(r.songKey, e);
    }
    return [...map.values()].sort((a, b) => b.last - a.last);
  },
};

// Message handler for the background service worker.
export async function handleHistoryMessage(msg) {
  const { op, args = [] } = msg;
  if (!['add', 'list', 'clear', 'songs'].includes(op)) throw new Error(`unknown history op ${op}`);
  return idbHistory[op](...args);
}
