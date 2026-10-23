// Converts the plain song extract produced by page-bridge.js into the
// trainer's chart format (docs/CHART_FORMAT.md). Pure function, no DOM.
//
// Timing comes from Songsterr's own timeline: part.timestamps has one entry
// (tab ms) per beat layout in playback order. That already includes tempo
// changes, gradual tempo changes and repeats, so we never recompute tempo
// maths ourselves; we only interpolate inside a measure.

import { CHART_FORMAT, CHART_VERSION, normalizeChart } from '../../core/chart.js';

// Playback order of measures, following repeat signs and alternate endings
// (Songsterr fields: repeatStart, repeat = total play count on the closing
// bar, alternateEnding = [pass numbers]).
export function expandRepeats(measures) {
  const order = [];
  let start = 0;
  let pass = 1;
  let i = 0;
  let guard = 0;
  while (i < measures.length && guard++ < 100000) {
    const m = measures[i];
    if (m.repeatStart && i !== start) { start = i; pass = 1; }
    const endings = m.alternateEnding;
    if (endings && endings.length && !endings.includes(pass)) { i++; continue; }
    order.push(i);
    if (m.repeat && m.repeat > 1) {
      if (pass < m.repeat) { pass++; i = start; continue; }
      pass = 1;
      start = i + 1;
    }
    i++;
  }
  return order;
}

// Beat positions that Songsterr gives a time. Empty layouts (no beats, e.g. the
// unused rest of a pickup bar) have no timestamp.
const timedLayouts = (m) => m.layouts.filter((l) => l.beats && l.beats.length > 0);
const layoutCount = (measures, order) => order.reduce((a, mi) => a + timedLayouts(measures[mi]).length, 0);

function bpmAt(metronome, ms) {
  let bpm = 120;
  for (const b of metronome) { if (b.t <= ms + 0.5) bpm = b.bpm; else break; } // +0.5: Songsterr rounds beat times
  return bpm;
}

// Slide types whose destination note is NOT picked again.
const LEGATO_SLIDES = new Set(['legato']);

export function songsterrToChart(song) {
  const warnings = [];
  const part = song.part;
  const measures = part.measures;
  const ts = part.timestamps;
  const metronome = song.metronome || [];

  const msPerTick = (ms) => 60000 / bpmAt(metronome, ms) / (part.tpqn || 960);
  let order = expandRepeats(measures);
  let estimated = false;
  if (layoutCount(measures, order) !== ts.length) {
    const linear = measures.map((_, i) => i);
    if (layoutCount(measures, linear) === ts.length) {
      warnings.push('Repeat structure did not match Songsterr\'s timeline; using bars in written order.');
      order = linear;
    } else {
      // Safety net: compute times from the tempo instead of refusing the tab.
      estimated = true;
      warnings.push(`Songsterr's timeline didn't match this tab (${ts.length} times for ${layoutCount(measures, order)} beat positions), so note times were calculated from the tempo. They may drift slightly against the music; please report this song.`);
    }
  }

  // --- bars (one per measure play) with their beat-layout times ---
  const plays = [];
  let k = 0;
  let cursorMs = 0;
  const firstTick = (l) => {
    const tick = Math.min(...l.beats.map((b) => b.startTick || 0));
    return Number.isFinite(tick) ? tick : 0;
  };
  for (const mi of order) {
    const m = measures[mi];
    let points;
    if (estimated) {
      const start = cursorMs, rate = msPerTick(start);
      points = timedLayouts(m).map((l) => ({ tick: firstTick(l), ms: start + firstTick(l) * rate }));
      cursorMs = start + (m.totalTicks || 0) * rate;
    } else {
      points = timedLayouts(m).map((l) => ({ tick: firstTick(l), ms: ts[k++] }));
    }
    plays.push({ mi, m, points });
  }
  plays.forEach((p, j) => {
    const first = p.points[0];
    const prevEnd = j > 0 ? plays[j - 1].endMs : 0;
    p.startMs = first ? first.ms - first.tick * msPerTick(first.ms) : prevEnd;
    const next = plays[j + 1];
    if (next && next.points[0]) {
      p.endMs = next.points[0].ms - next.points[0].tick * msPerTick(next.points[0].ms);
    } else if (next) {
      p.endMs = p.startMs + (p.m.totalTicks || 0) * msPerTick(p.startMs);
    } else {
      const last = p.points[p.points.length - 1] || { tick: 0, ms: p.startMs };
      p.endMs = last.ms + (p.m.totalTicks - last.tick) * msPerTick(last.ms);
    }
    p.points.push({ tick: p.m.totalTicks, ms: p.endMs });
    if (p.points[0].tick > 0) p.points.unshift({ tick: 0, ms: p.startMs });
  });

  const tickToMs = (p, tick) => {
    const pts = p.points;
    if (tick <= pts[0].tick) return pts[0].ms;
    for (let i = 1; i < pts.length; i++) {
      if (tick <= pts[i].tick) {
        const a = pts[i - 1], b = pts[i];
        return b.tick === a.tick ? a.ms : a.ms + ((tick - a.tick) / (b.tick - a.tick)) * (b.ms - a.ms);
      }
    }
    return pts[pts.length - 1].ms;
  };

  // --- sections ---
  const sections = [];
  let currentSection;
  const bars = plays.map((p, j) => {
    if (p.m.marker) {
      currentSection = p.m.marker;
      sections.push({ name: p.m.marker, t: p.startMs / 1000 });
    }
    return {
      i: j,
      t: p.startMs / 1000,
      end: p.endMs / 1000,
      measure: p.mi,
      sig: p.m.signature || [4, 4],
      bpm: bpmAt(metronome, p.startMs),
      section: currentSection,
    };
  });
  const duration = plays.length ? plays[plays.length - 1].endMs / 1000 : 0;
  sections.forEach((s, i) => { s.end = i + 1 < sections.length ? sections[i + 1].t : duration; });

  // --- beats ---
  const barAt = (sec) => {
    let lo = 0, hi = bars.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (bars[mid].t <= sec + 1e-6) lo = mid; else hi = mid - 1; }
    return lo;
  };
  let beats;
  if (metronome.length) {
    beats = metronome.map((b) => ({ t: b.t / 1000, bar: barAt(b.t / 1000), downbeat: b.beatNum === 1 }));
  } else {
    beats = [];
    for (const b of bars) {
      const n = b.sig[0];
      for (let i = 0; i < n; i++) beats.push({ t: b.t + ((b.end - b.t) * i) / n, bar: b.i, downbeat: i === 0 });
    }
  }

  // --- notes ---
  const strings = part.strings || part.tuning.length;
  const tuningHighFirst = part.tuning;
  const capo = part.capo || 0;
  const notes = [];
  const lastOnString = new Array(strings).fill(null);
  const pendingLegato = new Array(strings).fill(null); // origin note of hp/legato slide

  // `note` is the chart note that owns Songsterr note `n`'s slide/hp marks.
  function markLegatoOrigin(note, n, s) {
    if (n.slide) {
      note.flags.slide = { type: String(n.slide), toFret: null };
      if (LEGATO_SLIDES.has(n.slide)) pendingLegato[s] = { kind: 'slide', note };
      else if (n.slide === 'outDownwards') note.flags.slide.toFret = Math.max(0, note.fret - 3);
      else if (n.slide === 'outUpwards') note.flags.slide.toFret = note.fret + 3;
    }
    if (n.hp) pendingLegato[s] = { kind: 'hp', note };
  }

  plays.forEach((p, j) => {
    const beatsInBar = [];
    for (const l of p.m.layouts) for (const b of l.beats) beatsInBar.push(b);
    beatsInBar.sort((a, b) => a.startTick - b.startTick);
    for (const b of beatsInBar) {
      if (b.rest || !b.notes || !b.notes.length) continue;
      const t0 = tickToMs(p, b.startTick);
      const t1 = Math.min(tickToMs(p, b.startTick + (b.durationInTicks || 0)), p.endMs);
      for (const n of b.notes) {
        if (n.string === undefined || n.fret === undefined) continue;
        const s = strings - 1 - n.string;
        if (s < 0 || s >= strings) { warnings.push(`Note on unknown string ${n.string} in bar ${p.mi + 1}`); continue; }
        const prev = lastOnString[s];
        if (n.tie && prev) {
          // Tied note: lengthen the note it continues. Songsterr may put the
          // slide / hammer-on mark on the tied part, so move it over.
          prev.dur = Math.max(prev.dur, (t1 - prev.t * 1000) / 1000);
          markLegatoOrigin(prev, n, s);
          continue;
        }
        const note = {
          t: t0 / 1000,
          dur: Math.max(0, (t1 - t0) / 1000),
          string: s,
          fret: n.fret,
          midi: tuningHighFirst[n.string] + n.fret + capo,
          bar: j,
          flags: {
            dead: !!n.dead,
            ghost: !!n.ghost,
            hopo: false,
            slide: null,
            slideTarget: false,
            bend: !!n.bend,
            harmonic: !!(n.harmonic || b.harmonic),
            palmMute: !!(n.palmMute || b.palmMute),
            staccato: !!n.staccato,
            accent: !!(n.accentuated || n.heavyAccentuated),
            letRing: !!(n.letRing || b.letRing),
            vibrato: !!n.vibrato,
            grace: !!b.graceNote,
          },
        };
        // Destination of a hammer-on/pull-off or legato slide: no new attack.
        const origin = pendingLegato[s];
        if (origin) {
          if (origin.kind === 'hp') note.flags.hopo = true;
          else note.flags.slideTarget = true;
          if (origin.kind === 'slide') origin.note.flags.slide.toFret = n.fret;
          pendingLegato[s] = null;
        } else if (prev && prev.flags.slide && prev.flags.slide.toFret === null && prev.flags.slide.type === 'shift') {
          prev.flags.slide.toFret = n.fret;
        }
        markLegatoOrigin(note, n, s);
        lastOnString[s] = note;
        notes.push(note);
      }
    }
  });

  const chart = {
    format: CHART_FORMAT,
    version: CHART_VERSION,
    meta: {
      title: song.title || '',
      artist: song.artist || '',
      track: part.name || '',
      instrument: part.instrument || '',
      source: { type: 'songsterr', songId: song.songId, revisionId: song.revisionId, partId: song.partId },
    },
    instrument: {
      strings,
      tuning: [...tuningHighFirst].reverse(),
      frets: part.frets || 24,
      capo,
    },
    duration,
    bars,
    beats,
    sections,
    notes,
  };
  return { chart: normalizeChart(chart), warnings };
}

// Tracks that make sense to play on a bass: real bass tracks first, then any
// non-drum track whose lowest string is in bass range (e.g. Contrabass).
export function bassLikeTracks(tracks) {
  return tracks
    .filter((t) => !t.isDrums && !t.isEmpty && Array.isArray(t.tuning) && t.tuning.length >= 4 && t.tuning.length <= 6 &&
      (t.isBassGuitar || Math.min(...t.tuning) <= 33))
    .sort((a, b) => (b.isBassGuitar - a.isBassGuitar) || (a.partId - b.partId));
}
