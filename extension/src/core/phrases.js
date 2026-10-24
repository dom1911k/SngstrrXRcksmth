// Phrases, as Rocksmith 2014's riff repeater uses them: each section is cut
// into short pieces of 1, 2 or 4 bars (about 4–10 seconds each), so you can
// loop and master a song piece by piece. Phrases with the same notes (relative
// to their start) are marked as repeats of the first one.
//
//   phrasesOf(chart) -> [{ index, name, section, t, end, firstBar, lastBar, notes, same }]
//   phraseAt(chart, t), nextPracticeRange(chart, loop)

import { sectionsOf } from './history.js';

const TARGET_S = 8;   // aim for phrases of about this many seconds

// How many bars per phrase for a section: 1, 2 or 4.
export function barsPerPhrase(barCount, barSeconds) {
  const n = Math.max(1, Math.min(4, Math.round(TARGET_S / Math.max(0.3, barSeconds))));
  if (n >= 3) return barSeconds * 4 <= 11 && (barCount % 4 === 0 || barCount >= 6) ? 4 : 2;
  return n;
}

function signature(notes, t0) {
  return notes.map((n) => `${Math.round((n.t - t0) * 50)}:${n.string}:${n.fret}`).join(',');
}

const cache = new WeakMap();

export function phrasesOf(chart) {
  if (!chart || !chart.bars || !chart.bars.length) return [];
  if (cache.has(chart)) return cache.get(chart);
  const out = [];
  const sigs = new Map();
  for (const sec of sectionsOf(chart)) {
    const count = sec.lastBar - sec.firstBar + 1;
    const n = barsPerPhrase(count, (sec.end - sec.t) / count);
    const chunks = [];
    for (let b = sec.firstBar; b <= sec.lastBar; b += n) chunks.push([b, Math.min(sec.lastBar, b + n - 1)]);
    // A short leftover joins the phrase before it.
    if (chunks.length > 1) {
      const last = chunks[chunks.length - 1];
      if (last[1] - last[0] + 1 < Math.ceil(n / 2)) { chunks.pop(); chunks[chunks.length - 1][1] = last[1]; }
    }
    chunks.forEach(([a, b], k) => {
      const t = chart.bars[a].t, end = chart.bars[b].end;
      const notes = chart.notes.filter((x) => x.t >= t - 1e-4 && x.t < end - 1e-4);
      const sig = signature(notes, t);
      const first = notes.length ? sigs.get(sig) : undefined;
      const p = {
        index: out.length, section: sec.name, name: chunks.length > 1 ? `${sec.name} · ${k + 1}/${chunks.length}` : sec.name,
        t, end, firstBar: a, lastBar: b, notes: notes.length, same: first === undefined ? null : first,
        sectionFirst: sec.firstBar, sectionLast: sec.lastBar, lastOfSection: k === chunks.length - 1, phrasesInSection: chunks.length,
      };
      if (notes.length && first === undefined) sigs.set(sig, p.index);
      out.push(p);
    });
  }
  cache.set(chart, out);
  return out;
}

export function phraseAt(chart, t) {
  const list = phrasesOf(chart);
  let cur = list[0] || null;
  for (const p of list) { if (p.t <= t + 1e-3) cur = p; else break; }
  return cur;
}

const near = (a, b) => Math.abs(a - b) < 0.05;

// Phrase ladder: what to loop after mastering `loop` ({ start, end }).
// A phrase -> the next phrase of its section with new notes (repeats of a
// phrase you already passed are skipped); after the last one -> the whole
// section; a whole section (or a one-phrase section) -> the first phrase of
// the next section with notes. Returns { t, end, label, kind } or null.
export function nextPracticeRange(chart, loop) {
  const list = phrasesOf(chart);
  if (!loop || !list.length) return null;
  const sections = sectionsOf(chart);
  const sec = sections.find((s) => near(s.t, loop.start) && near(s.end, loop.end));
  const cur = sec ? null : list.find((p) => near(p.t, loop.start) && near(p.end, loop.end));
  const asRange = (p) => (p.phrasesInSection > 1
    ? { t: p.t, end: p.end, label: p.name, kind: 'phrase' }
    : { t: p.t, end: p.end, label: p.section, kind: 'section' });
  if (cur) {
    const next = list.find((p) => p.index > cur.index && p.sectionFirst === cur.sectionFirst && p.notes > 0 && (p.same === null || p.same > cur.index));
    if (next) return asRange(next);
    const s = sections.find((x) => x.firstBar === cur.sectionFirst);
    if (cur.phrasesInSection > 1) return { t: s.t, end: s.end, label: `the whole ${s.name}`, kind: 'section' };
    const after = list.find((p) => p.firstBar > s.lastBar && p.notes > 0);
    return after ? asRange(after) : null;
  }
  if (sec) {
    const after = list.find((p) => p.firstBar > sec.lastBar && p.notes > 0);
    return after ? asRange(after) : null;
  }
  return null;
}

// Loop the phrase that is playing now.
export function loopCurrentPhrase(adapter, notify = () => {}) {
  const chart = adapter.getChart();
  if (!chart || !chart.bars.length) return null;
  const p = phraseAt(chart, adapter.getTime());
  if (!p) return null;
  adapter.setLoop(p.t, p.end);
  adapter.seek(p.t);
  const a = chart.bars[p.firstBar].measure + 1, b = chart.bars[p.lastBar].measure + 1;
  notify(`Loop: ${p.name} (${a === b ? `bar ${a}` : `bars ${a}–${b}`})`);
  return p;
}
