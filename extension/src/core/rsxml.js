// Rocksmith 2014 arrangement XML (arr_bass_RS2.xml, what the RS2014 converter and other CDLC
// tools make) -> the trainer's chart format. Used to test a finished CDLC on the highway
// before installing it: times are seconds in the CDLC's own audio, so the chart lines up with
// project\audio.ogg (or .flac / .wav) without any offset.
//
// Only the hardest difficulty level is read (all of the notes). Works without DOMParser
// (also in Node tests): the files are plain, attribute-only XML.

import { CHART_FORMAT, CHART_VERSION, normalizeChart } from './chart.js';

// Standard tunings (MIDI, lowest string first) the XML's per-string offsets apply to.
const STANDARD = {
  bass: [28, 33, 38, 43, 48, 53],      // E1 A1 D2 G2 (C3 F3 for 6-string)
  guitar: [40, 45, 50, 55, 59, 64],    // E2 A2 D3 G3 B3 E4
};

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const unescape = (s) => s.replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) => {
  if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
  return ENTITIES[e] ?? m;
});

function attrs(tag) {
  const out = {};
  for (const m of tag.matchAll(/([\w:]+)\s*=\s*"([^"]*)"/g)) out[m[1]] = unescape(m[2]);
  return out;
}

function text(xml, name) {
  const m = xml.match(new RegExp(`<${name}>([^<]*)</${name}>`));
  return m ? unescape(m[1].trim()) : '';
}

// Every <name .../> or <name ...>...</name> element (with its inner XML).
function elements(xml, name) {
  const out = [];
  const re = new RegExp(`<${name}\\b([^>]*?)(/>|>([\\s\\S]*?)</${name}>)`, 'g');
  for (const m of xml.matchAll(re)) out.push({ a: attrs(m[1]), inner: m[3] || '' });
  return out;
}

const num = (v, d = 0) => (v === undefined || v === '' || Number.isNaN(Number(v)) ? d : Number(v));
const on = (v) => v !== undefined && v !== '0' && v !== '' && v !== 'false';

function noteFrom(a, t, tuning) {
  const string = num(a.string);
  const fret = num(a.fret);
  const slideTo = num(a.slideTo, -1);
  const slideUn = num(a.slideUnpitchTo, -1);
  return {
    t, dur: num(a.sustain), string, fret,
    flags: {
      dead: on(a.mute),
      ghost: on(a.ignore),
      hopo: on(a.hammerOn) || on(a.pullOff) || on(a.hopo),
      slide: slideTo >= 0 ? { type: 'shift', toFret: slideTo }
        : slideUn >= 0 ? { type: slideUn > fret ? 'outUpwards' : 'outDownwards', toFret: slideUn } : null,
      bend: num(a.bend) > 0,
      harmonic: on(a.harmonic) || on(a.harmonicPinch),
      palmMute: on(a.palmMute),
      accent: on(a.accent),
      vibrato: num(a.vibrato) > 0,
      letRing: false,
    },
    midi: tuning[string] + fret,
    linkNext: on(a.linkNext),
  };
}

export function isRocksmithXml(text_) {
  return /<song\b[^>]*>/.test(text_.slice(0, 4000)) && /<ebeats?\b/.test(text_);
}

export function parseRocksmithXml(xml, fileName = '') {
  if (!isRocksmithXml(xml)) throw new Error(`${fileName || 'The file'} is not a Rocksmith arrangement (.xml).`);
  const arrangement = text(xml, 'arrangement') || 'Bass';
  const isBass = /bass/i.test(arrangement);
  const tuneTag = (xml.match(/<tuning\b[^>]*>/) || [''])[0];
  const offs = attrs(tuneTag);
  const capo = num(text(xml, 'capo'));

  // Levels: take the one with the most notes (the full chart; with dynamic difficulty, the hardest).
  const levels = elements(xml, 'level').sort((x, y) => (y.inner.match(/<note\b/g) || []).length
    + (y.inner.match(/<chordNote\b/g) || []).length - (x.inner.match(/<note\b/g) || []).length
    - (x.inner.match(/<chordNote\b/g) || []).length);
  const level = levels[0] ? levels[0].inner : '';
  const notesXml = (level.match(/<notes\b[\s\S]*?<\/notes>/) || [''])[0];
  const chordsXml = (level.match(/<chords\b[\s\S]*?<\/chords>/) || [''])[0];

  let maxString = 3;
  const raw = [];
  for (const { a } of elements(notesXml, 'note')) raw.push({ a, t: num(a.time) });
  for (const c of elements(chordsXml, 'chord')) {
    for (const { a } of elements(c.inner, 'chordNote')) raw.push({ a, t: num(a.time, num(c.a.time)) });
  }
  for (const r of raw) maxString = Math.max(maxString, num(r.a.string));
  const strings = isBass ? Math.max(4, maxString + 1) : 6;
  const base = (isBass ? STANDARD.bass : STANDARD.guitar).slice(0, strings);
  const tuning = base.map((m, i) => m + num(offs[`string${i}`]));
  const notes = raw.map((r) => noteFrom(r.a, r.t, tuning)).map((n) => ({ ...n, midi: n.midi + capo }));

  // Tied notes (linkNext): merge the following note on the same string into this one.
  notes.sort((x, y) => x.t - y.t || x.string - y.string);
  const merged = [];
  const open = new Map(); // string -> note waiting for its tie
  for (const n of notes) {
    const prev = open.get(n.string);
    if (prev && n.fret === (prev.flags.slide ? prev.flags.slide.toFret : prev.fret) && n.t <= prev.t + prev.dur + 0.05) {
      prev.dur = Math.max(prev.dur, n.t + n.dur - prev.t);
      if (!n.linkNext) open.delete(n.string);
      continue;
    }
    open.delete(n.string);
    if (n.linkNext) open.set(n.string, n);
    merged.push(n);
  }
  for (const n of merged) delete n.linkNext;

  // Beats and bars from <ebeats>: measure >= 0 starts a bar.
  const ebeats = elements(xml, 'ebeat').map(({ a }) => ({ t: num(a.time), measure: num(a.measure, -1) }));
  const beats = [];
  const bars = [];
  for (const b of ebeats) {
    if (b.measure >= 0 || !bars.length) bars.push({ i: bars.length, t: b.t, measure: bars.length, beats: 0 });
    bars[bars.length - 1].beats++;
    beats.push({ t: b.t, bar: bars.length - 1, downbeat: b.measure >= 0 });
  }
  const songLength = num(text(xml, 'songLength'), ebeats.length ? ebeats[ebeats.length - 1].t : 0);
  bars.forEach((b, i) => {
    b.end = i + 1 < bars.length ? bars[i + 1].t : songLength;
    b.sig = [b.beats, 4];
    b.bpm = Math.round((60 * b.beats) / Math.max(0.05, b.end - b.t));
    delete b.beats;
  });

  const secs = elements(xml, 'section').map(({ a }) => ({ name: a.name || 'section', t: num(a.startTime) }))
    .sort((x, y) => x.t - y.t);
  const sections = secs.map((s, i) => ({
    name: s.name.charAt(0).toUpperCase() + s.name.slice(1),
    t: s.t, end: i + 1 < secs.length ? secs[i + 1].t : songLength,
  }));
  for (const bar of bars) {
    const s = sections.find((x) => x.t <= bar.t + 0.01 && bar.t < x.end - 0.01);
    if (s) bar.section = s.name;
  }
  for (const n of merged) {
    let lo = 0, hi = bars.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (bars[mid].t <= n.t + 1e-6) lo = mid; else hi = mid - 1; }
    n.bar = lo;
  }

  return normalizeChart({
    format: CHART_FORMAT,
    version: CHART_VERSION,
    meta: {
      title: text(xml, 'title') || fileName.replace(/\.xml$/i, ''),
      artist: text(xml, 'artistName'),
      track: `Rocksmith ${arrangement}`,
      instrument: isBass ? 'Bass' : arrangement,
      source: { type: 'rocksmith-xml', file: fileName },
    },
    instrument: { strings, tuning, frets: 24, capo: 0 },
    duration: songLength,
    bars, beats, sections, notes: merged,
  });
}
