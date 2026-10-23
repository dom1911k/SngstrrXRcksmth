// Setlists: your own lists of songs ("Band rehearsal", "Warm-up songs"). A
// setlist can be played in order: after each song the end screen offers the
// next one and keeps a running score (like Rocksmith's Nonstop Play).
//
// Stored in chrome.storage.local (small): 'setlists' = [{ id, name, songKeys, createdAt }],
// 'setlistRun' = { id, name, songKeys, index, scores: [{ songKey, accuracy }], startedAt }.

const KEY = 'setlists';
const RUN = 'setlistRun';
const mem = new Map();

const hasStorage = () => typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;
async function get(k) { return hasStorage() ? (await chrome.storage.local.get(k))[k] : mem.get(k); }
async function set(k, v) { if (hasStorage()) await chrome.storage.local.set({ [k]: v }); else mem.set(k, v); }
async function del(k) { if (hasStorage()) await chrome.storage.local.remove(k); else mem.delete(k); }

export async function loadSetlists() { return (await get(KEY)) || []; }
export async function saveSetlists(list) { await set(KEY, list); return list; }

// Pure list operations (exported for tests).
export function createSetlist(list, name, now = Date.now()) {
  const id = `sl${now.toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
  return [...list, { id, name: name.trim() || 'New setlist', songKeys: [], createdAt: now }];
}
export function toggleSong(list, id, songKey) {
  return list.map((s) => (s.id !== id ? s : { ...s, songKeys: s.songKeys.includes(songKey) ? s.songKeys.filter((k) => k !== songKey) : [...s.songKeys, songKey] }));
}
export function moveSong(list, id, songKey, dir) {
  return list.map((s) => {
    if (s.id !== id) return s;
    const keys = [...s.songKeys];
    const i = keys.indexOf(songKey), j = i + dir;
    if (i < 0 || j < 0 || j >= keys.length) return s;
    [keys[i], keys[j]] = [keys[j], keys[i]];
    return { ...s, songKeys: keys };
  });
}
export function renameSetlist(list, id, name) { return list.map((s) => (s.id === id ? { ...s, name: name.trim() || s.name } : s)); }
export function deleteSetlist(list, id) { return list.filter((s) => s.id !== id); }

// ---- playing a setlist ----
export function startRunState(setlist, now = Date.now()) {
  return { id: setlist.id, name: setlist.name, songKeys: [...setlist.songKeys], index: 0, scores: [], startedAt: now };
}

// A song of the running setlist was finished: record it and move on.
export function recordRunScore(run, songKey, accuracy) {
  if (!run || run.songKeys[run.index] !== songKey) return run;
  return { ...run, scores: [...run.scores, { songKey, accuracy }], index: run.index + 1 };
}

export function runSummary(run) {
  const n = run.scores.length;
  const avg = n ? run.scores.reduce((a, x) => a + (x.accuracy || 0), 0) / n : null;
  return { played: n, total: run.songKeys.length, average: avg, done: run.index >= run.songKeys.length, nextKey: run.songKeys[run.index] || null };
}

export async function getRun() {
  const r = await get(RUN);
  return r && Date.now() - r.startedAt < 6 * 3600 * 1000 ? r : null;  // a run expires after 6 h
}
export async function setRun(run) { if (run) await set(RUN, run); else await del(RUN); }
