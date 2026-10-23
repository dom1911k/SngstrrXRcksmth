// Session report: what you practised between starting and stopping the input
// (songs, passes, time, accuracy, personal bests, drill tempos). Shown when you
// stop the input and kept for the Library ("Recent sessions").

const MIN_SECONDS = 20;

function backend() {
  const ext = typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id;
  if (ext && typeof location !== 'undefined' && location.protocol === 'chrome-extension:') {
    return import('./history-db.js').then((m) => m.idbSessions);
  }
  if (ext) {
    const call = (op) => (...args) => new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: 'history', store: 'sessions', op, args }, (res) => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else if (!res || res.error) reject(new Error(res ? res.error : 'no response'));
        else resolve(res.result);
      });
    });
    return Promise.resolve({ add: call('add'), recent: call('recent') });
  }
  const list = [];
  return Promise.resolve({ async add(r) { list.push(r); return list.length; }, async recent(n = 20) { return [...list].reverse().slice(0, n); } });
}

let storePromise = null;
export function sessionStore() {
  if (!storePromise) storePromise = backend();
  return storePromise;
}

// Pure: the report from this session's records and, per song, the records
// from before the session (for personal bests).
export function buildReport(records, priorBySong, { start, end }) {
  const songs = new Map();
  for (const r of records) {
    const s = songs.get(r.songKey) || { songKey: r.songKey, title: r.title, artist: r.artist, passes: 0, seconds: 0, judged: 0, hits: 0, best: 0, bestFull: null, bestBpm: null };
    s.passes++;
    s.seconds += r.seconds || 0;
    s.judged += r.judged; s.hits += r.hits;
    s.best = Math.max(s.best, r.accuracy || 0);
    if ((r.speed || 1) >= 0.999) s.bestFull = Math.max(s.bestFull || 0, r.accuracy || 0);
    if (r.bpm && r.accuracy >= 0.9) s.bestBpm = Math.max(s.bestBpm || 0, Math.round(r.bpm * (r.speed || 1)));
    songs.set(r.songKey, s);
  }
  const highlights = [];
  for (const s of songs.values()) {
    const prior = priorBySong[s.songKey] || [];
    const priorFull = prior.filter((r) => (r.speed || 1) >= 0.999);
    s.prevBest = priorFull.length ? Math.max(...priorFull.map((r) => r.accuracy || 0)) : null;
    const priorBpm = prior.filter((r) => r.bpm && r.accuracy >= 0.9).map((r) => Math.round(r.bpm * (r.speed || 1)));
    s.prevBpm = priorBpm.length ? Math.max(...priorBpm) : null;
    s.accuracy = s.judged ? s.hits / s.judged : null;
    s.newBest = s.bestFull !== null && s.prevBest !== null && s.bestFull > s.prevBest + 0.005;
    if (s.bestBpm && (s.prevBpm === null || s.bestBpm > s.prevBpm)) highlights.push(`${s.title}: clean at ${s.bestBpm} BPM${s.prevBpm ? ` (was ${s.prevBpm})` : ''}`);
    else if (s.bestFull !== null && s.prevBest !== null && s.bestFull > s.prevBest + 0.005) highlights.push(`New personal best on ${s.title}: ${Math.round(s.bestFull * 100)}% (was ${Math.round(s.prevBest * 100)}%)`);
    else if (s.bestFull !== null && s.prevBest === null && !s.bestBpm) highlights.push(`First full-speed score on ${s.title}: ${Math.round(s.bestFull * 100)}%`);
  }
  const judged = records.reduce((a, r) => a + r.judged, 0);
  return {
    start, end,
    wallSeconds: Math.round((end - start) / 1000),
    practiceSeconds: Math.round(records.reduce((a, r) => a + (r.seconds || 0), 0)),
    passes: records.length,
    notes: judged,
    accuracy: judged ? records.reduce((a, r) => a + r.hits, 0) / judged : null,
    songs: [...songs.values()].sort((a, b) => b.seconds - a.seconds),
    highlights,
  };
}

export class SessionReport {
  constructor(engine, history, { store = sessionStore(), now = () => Date.now() } = {}) {
    this.engine = engine;
    this.history = history;
    this.store = store;
    this.now = now;
    this.current = null;
    this.last = null;
    this.listeners = new Set();
    engine.on('state', (st) => { if (st.running) this.begin(); else this.finish({ show: true }); });
    history.onSaved((rec) => { if (this.current) this.current.records.push(rec); });
    if (typeof window !== 'undefined') window.addEventListener('pagehide', () => this.finish({ show: false }));
  }

  onReport(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  begin() {
    if (!this.current) this.current = { start: this.now(), records: [] };
  }

  async finish({ show }) {
    const cur = this.current;
    this.current = null;
    if (!cur || !cur.records.length) return null;
    const end = this.now();
    if ((end - cur.start) / 1000 < MIN_SECONDS) return null;
    const prior = {};
    try {
      const hs = await this.history.store;
      for (const key of new Set(cur.records.map((r) => r.songKey))) prior[key] = (await hs.list(key)).filter((r) => r.at < cur.start);
    } catch { /* report without personal bests */ }
    const report = buildReport(cur.records, prior, { start: cur.start, end });
    this.last = report;
    try { await (await this.store).add(report); } catch (err) { console.warn('[Bass Trainer] could not save the session report', err); }
    if (show) for (const fn of this.listeners) fn(report);
    return report;
  }

  // The report so far (panel button), without ending the session.
  async preview() {
    const cur = this.current;
    if (!cur || !cur.records.length) return this.last;
    return buildReport(cur.records, {}, { start: cur.start, end: this.now() });
  }
}
