// Practice history: every scored pass (whole song, loop pass, or a good part
// of the song before you jumped away) is saved per song, with hits/misses per
// bar. aggregate() turns that into progress and "weak spots" (bars you miss most).
//
// Storage: IndexedDB of the extension (core/history-db.js). Content scripts on
// songsterr.com reach it through the background service worker; extension
// pages use it directly; without either (tests) it stays in memory.

const MIN_JUDGED = 4;

function backend() {
  const ext = typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id;
  if (ext && typeof location !== 'undefined' && location.protocol === 'chrome-extension:') {
    return import('./history-db.js').then((m) => m.idbHistory);
  }
  if (ext) {
    const call = (op) => (...args) => new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: 'history', op, args }, (res) => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else if (!res || res.error) reject(new Error(res ? res.error : 'no response'));
        else resolve(res.result);
      });
    });
    return Promise.resolve({ add: call('add'), list: call('list'), clear: call('clear'), songs: call('songs') });
  }
  return Promise.resolve(memoryHistory());
}

export function memoryHistory() {
  const recs = [];
  let id = 0;
  return {
    async add(r) { recs.push({ ...r, id: ++id }); return id; },
    async list(key) { return recs.filter((r) => r.songKey === key).sort((a, b) => a.at - b.at); },
    async clear(key) { const n = recs.length; for (let i = recs.length - 1; i >= 0; i--) if (recs[i].songKey === key) recs.splice(i, 1); return n - recs.length; },
    async songs() { return [...new Set(recs.map((r) => r.songKey))].map((songKey) => ({ songKey })); },
  };
}

let storePromise = null;
export function historyStore() {
  if (!storePromise) storePromise = backend();
  return storePromise;
}

// Identifies a song + track across sessions.
export function songKeyOf(chart) {
  if (!chart || !chart.meta) return null;
  const src = chart.meta.source || {};
  if (src.type === 'songsterr' && src.songId) return `songsterr:${src.songId}:${src.partId}`;
  const title = (chart.meta.title || '').trim();
  if (!title) return null;
  return `local:${(chart.meta.artist || '').trim().toLowerCase()}|${title.toLowerCase()}`;
}

// The record saved for one pass summary (from ScoringSession).
export function recordFromSummary(summary, chart) {
  const key = songKeyOf(chart);
  if (!key || !summary || summary.judged < MIN_JUDGED) return null;
  return {
    songKey: key,
    title: chart.meta.title || '',
    artist: chart.meta.artist || '',
    revisionId: chart.meta.source ? chart.meta.source.revisionId : undefined,
    barCount: chart.bars.length,
    at: summary.at || Date.now(),
    kind: summary.kind,
    speed: summary.speed || 1,
    accuracy: summary.accuracy,
    judged: summary.judged,
    hits: summary.hits,
    bestStreak: summary.bestStreak,
    avgOffsetMs: summary.avgOffsetMs,
    from: Number.isFinite(summary.from) ? summary.from : null,
    to: Number.isFinite(summary.to) ? summary.to : null,
    perBar: (summary.perBar || []).map((b) => [b.bar, b.hits, b.misses]),
  };
}

// Sections with their bar ranges: [{ name, t, end, firstBar, lastBar }].
// Without section markers the song is one section.
export function sectionsOf(chart) {
  const bars = chart ? chart.bars : [];
  if (!bars.length) return [];
  const marks = (chart.sections || []).filter((s) => Number.isFinite(s.t));
  const list = marks.length ? marks : [{ name: 'Song', t: bars[0].t }];
  const out = [];
  list.forEach((m, k) => {
    const next = list[k + 1] ? list[k + 1].t : Infinity;
    let first = -1, last = -1;
    bars.forEach((b, i) => { if (b.t >= m.t - 1e-3 && b.t < next - 1e-3) { if (first < 0) first = i; last = i; } });
    if (first < 0) return;
    out.push({ name: m.name || `Part ${k + 1}`, t: bars[first].t, end: bars[last].end, firstBar: first, lastBar: last });
  });
  // Bars before the first marker (pickup / intro without a name).
  if (out.length && out[0].firstBar > 0) out.unshift({ name: 'Start', t: bars[0].t, end: bars[out[0].firstBar - 1].end, firstBar: 0, lastBar: out[0].firstBar - 1 });
  return out;
}

const dayKey = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// Progress for one song. Bar statistics only use passes made on the same
// tab layout (same number of bars), so an edited tab doesn't mix bars up.
// Recent passes count more (half weight after 20 passes of that bar).
export function aggregate(records, chart) {
  const bars = chart ? chart.bars : [];
  const sameLayout = records.filter((r) => !chart || r.barCount === bars.length);
  const perBar = new Map();
  for (let i = sameLayout.length - 1, n = 0; i >= 0; i--, n++) {
    for (const [bar, hits, misses] of sameLayout[i].perBar || []) {
      const e = perBar.get(bar) || { bar, hits: 0, misses: 0, w: 0, wMiss: 0, passes: 0 };
      const weight = Math.pow(0.5, e.passes / 20);
      e.hits += hits; e.misses += misses;
      e.w += weight * (hits + misses); e.wMiss += weight * misses;
      e.passes++;
      perBar.set(bar, e);
    }
  }
  const barInfo = (bar) => ({ number: bars[bar] ? bars[bar].measure + 1 : bar + 1, section: bars[bar] ? bars[bar].section : undefined, t: bars[bar] ? bars[bar].t : null, end: bars[bar] ? bars[bar].end : null });
  const barStats = [...perBar.values()].map((e) => ({ ...e, ...barInfo(e.bar), missRate: e.w ? e.wMiss / e.w : 0 }));
  const weakBars = barStats.filter((e) => e.misses > 0 && e.hits + e.misses >= 3)
    .sort((a, b) => b.missRate - a.missRate || b.misses - a.misses).slice(0, 8);

  // Sections (in song order), from the chart's section markers.
  const sections = sectionsOf(chart).map((sec) => ({ ...sec, hits: 0, misses: 0 }));
  for (const sec of sections) {
    for (let i = sec.firstBar; i <= sec.lastBar; i++) {
      const e = perBar.get(i);
      if (e) { sec.hits += e.hits; sec.misses += e.misses; }
    }
    sec.accuracy = sec.hits + sec.misses ? sec.hits / (sec.hits + sec.misses) : null;
  }

  // Daily best/average accuracy at full speed and overall.
  const days = new Map();
  for (const r of records) {
    const k = dayKey(r.at);
    const d = days.get(k) || { day: k, passes: 0, judged: 0, hits: 0, best: 0, minutes: 0 };
    d.passes++; d.judged += r.judged; d.hits += r.hits;
    d.best = Math.max(d.best, r.accuracy || 0);
    days.set(k, d);
  }
  const songs = records.filter((r) => r.kind === 'song');
  const best = (list) => list.reduce((m, r) => (r.accuracy > m ? r.accuracy : m), 0);
  return {
    passes: records.length,
    fullPlays: songs.length,
    bestFull: songs.length ? best(songs.filter((r) => r.speed >= 0.999)) || null : null,
    bestAny: records.length ? best(records) : null,
    last: records.length ? records[records.length - 1] : null,
    days: [...days.values()].map((d) => ({ ...d, accuracy: d.judged ? d.hits / d.judged : null })),
    sections,
    barStats,
    weakBars,
  };
}

// Saves every pass summary of a scoring session.
export class HistoryRecorder {
  constructor(session, { store = historyStore() } = {}) {
    this.session = session;
    this.store = store;
    this.listeners = new Set();
    session.on('summary', (s) => this.save(s));
  }

  onSaved(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  async save(summary) {
    const rec = recordFromSummary(summary, this.session.chart);
    if (!rec) return null;
    try {
      const st = await this.store;
      await st.add(rec);
      for (const fn of this.listeners) fn(rec);
      return rec;
    } catch (err) {
      console.warn('[Bass Trainer] could not save practice history', err);
      return null;
    }
  }

  async load(chart = this.session.chart) {
    const key = songKeyOf(chart);
    if (!key) return { key: null, records: [], stats: aggregate([], chart) };
    const st = await this.store;
    const records = await st.list(key);
    return { key, records, stats: aggregate(records, chart) };
  }

  async clear(chart = this.session.chart) {
    const key = songKeyOf(chart);
    if (!key) return 0;
    return (await this.store).clear(key);
  }
}
