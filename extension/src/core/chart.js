// The trainer's chart format. Spec: docs/CHART_FORMAT.md.
// Everything outside adapters/ works only with this format.

export const CHART_FORMAT = 'bass-chart';
export const CHART_VERSION = 1;

const DEFAULT_FLAGS = {
  dead: false, ghost: false, hopo: false, slide: null, slideTarget: false, bend: false,
  harmonic: false, palmMute: false, staccato: false, accent: false, letRing: false, vibrato: false, grace: false,
};

// Fill defaults, compute midi where missing, sort. Returns the same object.
export function normalizeChart(chart) {
  const tuning = chart.instrument.tuning;
  const capo = chart.instrument.capo || 0;
  for (const n of chart.notes) {
    n.flags = { ...DEFAULT_FLAGS, ...(n.flags || {}) };
    if (n.dur === undefined) n.dur = 0;
    if (n.midi === undefined) n.midi = tuning[n.string] + n.fret + capo;
  }
  chart.notes.sort((a, b) => a.t - b.t || a.string - b.string);
  chart.beats = (chart.beats || []).sort((a, b) => a.t - b.t);
  chart.bars = (chart.bars || []).sort((a, b) => a.t - b.t);
  chart.sections = chart.sections || [];
  if (chart.duration === undefined) {
    const lastNote = chart.notes.reduce((m, n) => Math.max(m, n.t + n.dur), 0);
    const lastBar = chart.bars.length ? chart.bars[chart.bars.length - 1].end || 0 : 0;
    chart.duration = Math.max(lastNote, lastBar);
  }
  return chart;
}

// Checks a chart (e.g. loaded from a file). Returns a list of problems.
export function validateChart(chart) {
  const errors = [];
  if (!chart || typeof chart !== 'object') return ['Not a JSON object.'];
  if (chart.format !== CHART_FORMAT) errors.push(`"format" must be "${CHART_FORMAT}".`);
  if (chart.version !== CHART_VERSION) errors.push(`"version" must be ${CHART_VERSION}.`);
  const inst = chart.instrument;
  if (!inst || !Array.isArray(inst.tuning) || inst.tuning.length < 4 || inst.tuning.length > 6) {
    errors.push('"instrument.tuning" must be an array of 4–6 MIDI numbers, lowest string first.');
  } else if (inst.strings !== undefined && inst.strings !== inst.tuning.length) {
    errors.push('"instrument.strings" must equal the tuning length.');
  }
  if (!Array.isArray(chart.notes)) errors.push('"notes" must be an array.');
  else {
    const strings = inst && Array.isArray(inst.tuning) ? inst.tuning.length : 4;
    chart.notes.forEach((n, i) => {
      if (typeof n.t !== 'number' || n.t < 0) errors.push(`notes[${i}].t must be a time in seconds >= 0.`);
      if (!Number.isInteger(n.string) || n.string < 0 || n.string >= strings) errors.push(`notes[${i}].string must be 0..${strings - 1} (0 = lowest).`);
      if (!Number.isInteger(n.fret) || n.fret < 0 || n.fret > 30) errors.push(`notes[${i}].fret must be 0..30.`);
      if (n.dur !== undefined && (typeof n.dur !== 'number' || n.dur < 0)) errors.push(`notes[${i}].dur must be seconds >= 0.`);
    });
  }
  if (chart.beats !== undefined && !Array.isArray(chart.beats)) errors.push('"beats" must be an array.');
  return errors.slice(0, 20);
}

// Index of the first note with t >= time (binary search).
export function firstNoteAtOrAfter(notes, time) {
  let lo = 0, hi = notes.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (notes[mid].t < time) lo = mid + 1; else hi = mid; }
  return lo;
}

// Hand positions ("anchors"), Rocksmith style: the fretting hand covers a
// 4-fret span starting at the anchor fret. Greedy segmentation: a segment
// keeps growing while all its fretted notes fit in the span. Open strings
// never move the hand.
export function computeAnchors(notes, span = 4) {
  const anchors = [];
  let cur = null;
  for (const n of notes) {
    if (n.fret === 0 || n.flags.ghost) continue;
    if (cur && n.fret >= cur.min && n.fret <= cur.min + span - 1 && n.fret >= cur.max - span + 1) {
      cur.max = Math.max(cur.max, n.fret);
      cur.end = n.t + n.dur;
      continue;
    }
    if (cur && n.fret < cur.min && cur.max - n.fret <= span - 1) {
      // Fits by stretching the span downwards.
      cur.min = n.fret;
      cur.end = n.t + n.dur;
      continue;
    }
    cur = { t: n.t, end: n.t + n.dur, min: n.fret, max: n.fret };
    anchors.push(cur);
  }
  // Each anchor lasts until the next one starts.
  for (let i = 0; i < anchors.length; i++) {
    anchors[i].until = i + 1 < anchors.length ? anchors[i + 1].t : Infinity;
    anchors[i].fret = anchors[i].min;
  }
  return anchors;
}

export function anchorAt(anchors, time) {
  let lo = 0, hi = anchors.length - 1, best = anchors.length ? 0 : -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (anchors[mid].t <= time) { best = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return best >= 0 ? anchors[best] : null;
}
