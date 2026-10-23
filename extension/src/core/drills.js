// Warm-up and technique drills, generated as normal bass charts so they play,
// score and are saved like songs (standalone player, with a metronome click).
//
//   makeDrill(id, { bpm, bars, position, tuning }) -> chart
//
// One empty bar first (to get ready), then the exercise. Positions are the
// fret under the first finger; patterns stay within four frets (one finger
// per fret) unless noted.

import { normalizeChart } from './chart.js';

export const DRILLS = [
  {
    id: 'chromatic', name: 'Chromatic 1-2-3-4',
    description: 'One finger per fret, up across all strings and back down, moving up one fret each time. Warms up both hands.',
    defaults: { bpm: 80, bars: 8, position: 1 },
  },
  {
    id: 'spider', name: 'Spider (string crossing)',
    description: 'Fingers 1 and 3 on one string, 2 and 4 on the next: trains clean string changes and finger independence.',
    defaults: { bpm: 70, bars: 8, position: 3 },
  },
  {
    id: 'octaves', name: 'Octaves',
    description: 'Root and octave (two strings up, two frets up) through a I–IV–V–I progression. Mute the string in between.',
    defaults: { bpm: 90, bars: 8, position: 3 },
  },
  {
    id: 'root-fifth', name: 'Root–fifth–octave',
    description: 'The classic bass pattern R–5–8–5 through I–IV–V–I. Keep every note the same length.',
    defaults: { bpm: 90, bars: 8, position: 3 },
  },
  {
    id: 'major-scale', name: 'Major scale (one octave)',
    description: 'Up and down the major scale from the E string, finger 2 on the root. Moves to a new key every two bars.',
    defaults: { bpm: 80, bars: 8, position: 3 },
  },
  {
    id: 'lock-in', name: 'Metronome lock-in (rising tempo)',
    description: 'Steady eighth notes on open strings; the tempo rises by 4 BPM every two bars. Stay exactly on the click.',
    defaults: { bpm: 80, bars: 12, position: 0 },
  },
  {
    id: 'sixteenths', name: 'Sixteenth-note endurance',
    description: 'Even sixteenths alternating plucking fingers, one bar per string. Watch that every note is equally loud.',
    defaults: { bpm: 70, bars: 8, position: 5 },
  },
];

export function drillById(id) { return DRILLS.find((d) => d.id === id) || null; }

// Per bar: a list of [beatPosition (in quarters), string, fret, durationQuarters].
function patternBars(id, { bars, position: p }) {
  const out = [];
  const E = 0, A = 1, D = 2, G = 3;
  const prog = [0, 5, 7, 0]; // I IV V I as fret offsets on the E string
  for (let b = 0; b < bars; b++) {
    const ev = [];
    if (id === 'chromatic') {
      const pos = p + Math.floor(b / 2);
      const up = b % 2 === 0;
      const strings = up ? [E, A, D, G] : [G, D, A, E];
      strings.forEach((s, i) => {
        const frets = up ? [0, 1, 2, 3] : [3, 2, 1, 0];
        frets.forEach((f, j) => ev.push([(i * 4 + j) * 0.25, s, pos + f, 0.25]));
      });
    } else if (id === 'spider') {
      // 1-3 on s, 2-4 on s+1, eighth notes, crossing E/A, A/D, D/G, back.
      const pairs = [[E, A], [A, D], [D, G], [A, D]];
      const [s1, s2] = pairs[b % 4];
      const seq = [[s1, 0], [s2, 1], [s1, 2], [s2, 3], [s1, 2], [s2, 1], [s1, 0], [s2, 3]];
      seq.forEach(([s, f], i) => ev.push([i * 0.5, s, p + f, 0.5]));
    } else if (id === 'octaves') {
      const r = p + prog[b % 4];
      for (let i = 0; i < 8; i++) ev.push([i * 0.5, i % 2 ? D : E, i % 2 ? r + 2 : r, 0.45]);
    } else if (id === 'root-fifth') {
      const r = p + prog[b % 4];
      [[E, r], [A, r + 2], [D, r + 2], [A, r + 2]].forEach(([s, f], i) => ev.push([i, s, f, 0.9]));
    } else if (id === 'major-scale') {
      const r = p + [0, 0, 5, 5][b % 4];
      const up = [[E, r], [E, r + 2], [A, r - 1], [A, r], [A, r + 2], [D, r - 1], [D, r + 1], [D, r + 2]];
      const seq = b % 2 === 0 ? up : [...up].reverse();
      seq.forEach(([s, f], i) => ev.push([i * 0.5, s, Math.max(0, f), 0.45]));
    } else if (id === 'lock-in') {
      const s = [E, A, D, A][Math.floor(b / 2) % 4];
      for (let i = 0; i < 8; i++) ev.push([i * 0.5, s, 0, 0.4]);
    } else if (id === 'sixteenths') {
      const s = [E, A, D, G][b % 4];
      for (let i = 0; i < 16; i++) ev.push([i * 0.25, s, p + (i % 4 === 0 ? 0 : 2), 0.22]);
    }
    out.push(ev);
  }
  return out;
}

export function makeDrill(id, opts = {}) {
  const d = drillById(id);
  if (!d) throw new Error(`unknown drill ${id}`);
  const o = { ...d.defaults, ...opts };
  const tuning = o.tuning || [28, 33, 38, 43];
  const bpm = Math.max(30, Math.min(240, Math.round(o.bpm)));
  const ramp = id === 'lock-in' ? 4 : 0;
  const pattern = patternBars(id, { bars: o.bars, position: Math.max(id === 'lock-in' ? 0 : 1, Math.min(15, o.position)) });
  const bars = [], beats = [], notes = [];
  let t = 0;
  const total = pattern.length + 1;
  for (let i = 0; i < total; i++) {
    const tempo = bpm + (i > 0 ? ramp * Math.floor((i - 1) / 2) : 0);
    const q = 60 / tempo;
    bars.push({ i, t: +t.toFixed(4), end: +(t + 4 * q).toFixed(4), measure: i, sig: [4, 4], bpm: tempo, section: i === 0 ? 'Get ready' : d.name });
    for (let k = 0; k < 4; k++) beats.push({ t: +(t + k * q).toFixed(4), downbeat: k === 0 });
    if (i > 0) {
      for (const [pos, string, fret, dur] of pattern[i - 1]) {
        if (string >= tuning.length) continue;
        notes.push({ t: +(t + pos * q).toFixed(4), string, fret, dur: +(dur * q).toFixed(4), bar: i, flags: {} });
      }
    }
    t += 4 * q;
  }
  return normalizeChart({
    format: 'bass-chart', version: 1,
    meta: { title: `Drill: ${d.name}`, artist: `${bpm} BPM${ramp ? ' rising' : ''}`, track: 'Drill', metronome: true,
      source: { type: 'drill', id, bpm } },
    instrument: { strings: tuning.length, tuning },
    duration: t,
    bars, beats, notes,
    sections: [{ name: 'Get ready', t: 0 }, { name: d.name, t: bars[1].t }],
  });
}
