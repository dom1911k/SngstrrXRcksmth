// Practice history storage: IndexedDB in the extension's own origin, so the
// Songsterr page and the standalone player share it and clearing Songsterr's
// site data doesn't delete it. Used directly by extension pages and by the
// background service worker (which serves content scripts, see history.js).

const DB_NAME = 'bass-trainer';
const STORE = 'passes';
const SONGS = 'songs';        // song library (favourites, status, notes, layout)
const AUDIO = 'audio';        // audio files of saved player songs
const SESSIONS = 'sessions';  // session reports
const MAX_PER_SONG = 500;

let dbPromise = null;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 3);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
          store.createIndex('song', 'songKey');
        }
        if (!db.objectStoreNames.contains(SONGS)) db.createObjectStore(SONGS, { keyPath: 'songKey' });
        if (!db.objectStoreNames.contains(AUDIO)) db.createObjectStore(AUDIO, { keyPath: 'songKey' });
        if (!db.objectStoreNames.contains(SESSIONS)) db.createObjectStore(SESSIONS, { keyPath: 'id', autoIncrement: true });
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

async function store(mode, name = STORE) {
  return (await open()).transaction(name, mode).objectStore(name);
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
  async all() {
    return done((await store('readonly')).getAll());
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

// Song library entries: { songKey, title, artist, track, kind, url, tuning,
// favorite, status, notes, addedAt, lastOpenedAt, layout, chart?, hasAudio }.
export const idbLibrary = {
  async get(songKey) { return (await done((await store('readonly', SONGS)).get(songKey))) || null; },
  async all() { return done((await store('readonly', SONGS)).getAll()); },
  async put(entry) { await done((await store('readwrite', SONGS)).put(entry)); return entry; },
  // Merge fields into an entry (created if missing).
  async patch(songKey, fields) {
    const cur = (await this.get(songKey)) || { songKey, addedAt: Date.now(), favorite: false, status: 'new', notes: '' };
    return this.put({ ...cur, ...fields, songKey });
  },
  async remove(songKey) {
    await done((await store('readwrite', SONGS)).delete(songKey));
    await done((await store('readwrite', AUDIO)).delete(songKey));
    return true;
  },
  async putAudio(songKey, blob, name) { await done((await store('readwrite', AUDIO)).put({ songKey, blob, name })); return true; },
  async getAudio(songKey) { return (await done((await store('readonly', AUDIO)).get(songKey))) || null; },
};

// Session reports (core/session-report.js).
export const idbSessions = {
  async add(report) { return done((await store('readwrite', SESSIONS)).add(report)); },
  async recent(n = 20) {
    const all = await done((await store('readonly', SESSIONS)).getAll());
    return all.sort((a, b) => b.end - a.end).slice(0, n);
  },
};

// Message handler for the background service worker.
export async function handleHistoryMessage(msg) {
  const { op, args = [] } = msg;
  if (msg.store === 'sessions') {
    if (!['add', 'recent'].includes(op)) throw new Error(`unknown sessions op ${op}`);
    return idbSessions[op](...args);
  }
  if (msg.store === 'library') {
    if (!['get', 'all', 'put', 'patch', 'remove'].includes(op)) throw new Error(`unknown library op ${op}`);
    return idbLibrary[op](...args);
  }
  if (!['add', 'list', 'clear', 'songs', 'all'].includes(op)) throw new Error(`unknown history op ${op}`);
  return idbHistory[op](...args);
}
