// Song library: every bass track you open is remembered (title, link, tuning,
// bar layout); you can mark favourites, set a status (new / learning /
// practising / mastered) and keep notes. Statistics come from the practice
// history. Shown on the Library page (library/library.html).
//
// Storage: IndexedDB of the extension (core/history-db.js, store 'songs').
// Content scripts reach it through the background service worker.

import { songKeyOf } from './history.js';
import { tuningName } from './music.js';

export const STATUSES = [
  ['new', 'New'], ['learning', 'Learning'], ['practising', 'Practising'], ['mastered', 'Mastered'],
];

function backend() {
  const ext = typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id;
  if (ext && typeof location !== 'undefined' && location.protocol === 'chrome-extension:') {
    return import('./history-db.js').then((m) => m.idbLibrary);
  }
  if (ext) {
    const call = (op) => (...args) => new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: 'history', store: 'library', op, args }, (res) => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else if (!res || res.error) reject(new Error(res ? res.error : 'no response'));
        else resolve(res.result);
      });
    });
    return Promise.resolve({ get: call('get'), all: call('all'), put: call('put'), patch: call('patch'), remove: call('remove') });
  }
  return Promise.resolve(memoryLibrary());
}

export function memoryLibrary() {
  const map = new Map();
  return {
    async get(k) { return map.get(k) || null; },
    async all() { return [...map.values()]; },
    async put(e) { map.set(e.songKey, e); return e; },
    async patch(k, f) { const cur = map.get(k) || { songKey: k, addedAt: Date.now(), favorite: false, status: 'new', notes: '' }; const e = { ...cur, ...f, songKey: k }; map.set(k, e); return e; },
    async remove(k) { return map.delete(k); },
  };
}

let storePromise = null;
export function libraryStore() {
  if (!storePromise) storePromise = backend();
  return storePromise;
}

// Bars and sections, enough for statistics and "practise bar 12" later.
export function layoutOf(chart) {
  return {
    bars: (chart.bars || []).map((b) => ({ t: +b.t.toFixed(3), end: +b.end.toFixed(3), measure: b.measure, section: b.section })),
    sections: (chart.sections || []).map((s) => ({ name: s.name, t: +s.t.toFixed(3) })),
  };
}

export function entryFields(chart, { url } = {}) {
  const src = (chart.meta && chart.meta.source) || {};
  const kind = src.type === 'songsterr' ? 'songsterr' : src.type === 'drill' ? 'drill' : 'local';
  return {
    title: (chart.meta && chart.meta.title) || 'Untitled',
    artist: (chart.meta && chart.meta.artist) || '',
    track: (chart.meta && (chart.meta.track || chart.meta.instrument)) || '',
    kind,
    url: kind === 'songsterr' ? url : undefined,
    drillId: kind === 'drill' ? src.id : undefined,
    tuning: tuningName(chart.instrument.tuning),
    strings: chart.instrument.strings || chart.instrument.tuning.length,
    duration: Math.round(chart.duration || 0),
    notesCount: chart.notes.length,
    layout: layoutOf(chart),
  };
}

const DAY = 86400000;
const dayStart = (ms) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };
const passSeconds = (r) => (r.seconds > 0 ? r.seconds : Math.max(5, r.judged * 0.5 / (r.speed || 1)));

// Statistics of one song from its history records (oldest first).
export function songStats(records) {
  if (!records.length) return { passes: 0, seconds: 0, best: null, bestFull: null, last: null, trend: null, days: 0, recent: [], lastAt: null, firstAt: null, bestBpm: null };
  const acc = records.map((r) => r.accuracy || 0);
  const full = records.filter((r) => (r.speed || 1) >= 0.999);
  const recent = acc.slice(-20);
  const a5 = acc.slice(-5), b5 = acc.slice(-10, -5);
  const avg = (xs) => xs.reduce((a, x) => a + x, 0) / xs.length;
  const bpms = records.filter((r) => r.bpm && r.accuracy >= 0.9).map((r) => Math.round(r.bpm * (r.speed || 1)));
  return {
    passes: records.length,
    seconds: Math.round(records.reduce((a, r) => a + passSeconds(r), 0)),
    best: Math.max(...acc),
    bestFull: full.length ? Math.max(...full.map((r) => r.accuracy || 0)) : null,
    bestSpeed: Math.max(...records.filter((r) => r.accuracy >= 0.9).map((r) => r.speed || 1), 0) || null,
    last: acc[acc.length - 1],
    trend: b5.length >= 3 ? avg(a5) - avg(b5) : null,
    days: new Set(records.map((r) => dayStart(r.at))).size,
    recent,
    firstAt: records[0].at,
    lastAt: records[records.length - 1].at,
    bestBpm: bpms.length ? Math.max(...bpms) : null,
  };
}

// Practice overview over all songs.
export function overallStats(records, now = Date.now()) {
  const today = dayStart(now);
  const weekAgo = today - 6 * DAY;
  const perDay = new Map();
  for (const r of records) {
    const d = dayStart(r.at);
    perDay.set(d, (perDay.get(d) || 0) + passSeconds(r));
  }
  let streak = 0;
  for (let d = perDay.has(today) ? today : today - DAY; perDay.has(d); d -= DAY) streak++;
  const week = records.filter((r) => r.at >= weekAgo);
  const days = [];
  for (let i = 27; i >= 0; i--) { const d = today - i * DAY; days.push({ day: d, seconds: Math.round(perDay.get(d) || 0) }); }
  const weekJudged = week.reduce((a, r) => a + r.judged, 0);
  return {
    totalSeconds: Math.round(records.reduce((a, r) => a + passSeconds(r), 0)),
    totalPasses: records.length,
    songs: new Set(records.map((r) => r.songKey)).size,
    weekSeconds: Math.round(week.reduce((a, r) => a + passSeconds(r), 0)),
    weekPasses: week.length,
    weekSongs: new Set(week.map((r) => r.songKey)).size,
    weekAccuracy: weekJudged ? week.reduce((a, r) => a + r.hits, 0) / weekJudged : null,
    streak,
    days,
  };
}

// Keeps the library up to date while you practise (Songsterr page or player),
// and runs a "practise this" request made on the Library page.
export class LibraryTracker {
  constructor(adapter, { store = libraryStore(), url = () => (typeof location !== 'undefined' ? location.href : undefined), onPending = () => {} } = {}) {
    this.adapter = adapter;
    this.store = store;
    this.url = url;
    this.onPending = onPending;
    this.entry = null;
    this.listeners = new Set();
    adapter.on('chart', (info) => this.onChart(info));
  }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  changed() { for (const fn of this.listeners) fn(this.entry); }

  async onChart(info) {
    const chart = info && info.isBassLike ? info.chart : null;
    this.entry = null;
    this.changed();
    const key = chart ? songKeyOf(chart) : null;
    if (!key) return;
    try {
      const st = await this.store;
      const fields = { ...entryFields(chart, { url: this.url() }), lastOpenedAt: Date.now() };
      if (fields.kind === 'local') fields.chart = chart;  // so it can be reopened from the library
      this.entry = await st.patch(key, fields);
      this.changed();
      const pending = await takePending(key);
      if (pending) this.onPending(pending);
    } catch (err) {
      console.warn('[Bass Trainer] library unavailable', err);
    }
  }

  async setFavorite(on) {
    if (!this.entry) return null;
    this.entry = await (await this.store).patch(this.entry.songKey, { favorite: on, ...(on && this.entry.status === 'new' ? { status: 'learning' } : {}) });
    this.changed();
    return this.entry;
  }

  toggleFavorite() { return this.setFavorite(!(this.entry && this.entry.favorite)); }
}

// "Practise bar 12 of this song" from the Library page: stored until the song
// is opened (chrome.storage.local, 10 minutes).
const PENDING = 'libraryPending';
export async function setPending(action) {
  if (typeof chrome === 'undefined' || !chrome.storage) return;
  await chrome.storage.local.set({ [PENDING]: { ...action, at: Date.now() } });
}
export async function takePending(songKey) {
  if (typeof chrome === 'undefined' || !chrome.storage) return null;
  const p = (await chrome.storage.local.get(PENDING))[PENDING];
  if (!p || p.songKey !== songKey || Date.now() - p.at > 10 * 60 * 1000) return null;
  await chrome.storage.local.remove(PENDING);
  return p;
}
