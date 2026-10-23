// Fretboard trainer screen (standalone player): prompt, a fretboard diagram,
// feedback and the round result.
import { h } from './dom.js';
import { NOTE_NAMES, stringColors } from '../core/music.js';

const NS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}) => { const el = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v); return el; };

// Fretboard diagram: lowest string at the bottom (like looking down at the bass).
function fretboard(tuning, maxFret, mark = null) {
  const W = 760, H = 40 + tuning.length * 34, x0 = 46, fw = (W - x0 - 20) / maxFret;
  const yOf = (s) => H - 26 - s * 34;
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'fb' });
  const colors = stringColors(tuning.length);
  root.append(svg('rect', { x: x0, y: yOf(tuning.length - 1) - 14, width: maxFret * fw, height: (tuning.length - 1) * 34 + 28, rx: 6, fill: '#1a2030' }));
  for (const f of [3, 5, 7, 9, 12, 15]) {
    if (f > maxFret) continue;
    const cx = x0 + (f - 0.5) * fw, mid = (yOf(0) + yOf(tuning.length - 1)) / 2;
    for (const dy of f === 12 ? [-34, 34] : [0]) root.append(svg('circle', { cx, cy: mid + dy, r: 6, fill: '#3a4256' }));
  }
  for (let f = 0; f <= maxFret; f++) {
    root.append(svg('line', { x1: x0 + f * fw, x2: x0 + f * fw, y1: yOf(tuning.length - 1) - 14, y2: yOf(0) + 14, stroke: f === 0 ? '#d8dce4' : '#6d7790', 'stroke-width': f === 0 ? 5 : 2 }));
    const t = svg('text', { x: x0 + (f - 0.5) * fw, y: H - 4, fill: '#7d8597', 'font-size': 12, 'text-anchor': 'middle' });
    t.textContent = f ? String(f) : '';
    root.append(t);
  }
  tuning.forEach((m, s) => {
    root.append(svg('line', { x1: x0, x2: x0 + maxFret * fw, y1: yOf(s), y2: yOf(s), stroke: colors[s], 'stroke-width': 2 + (tuning.length - s) * 0.6 }));
    const t = svg('text', { x: 18, y: yOf(s) + 5, fill: colors[s], 'font-size': 15, 'font-weight': 700, 'text-anchor': 'middle' });
    t.textContent = NOTE_NAMES[m % 12];
    root.append(t);
  });
  if (mark) {
    const cx = mark.fret === 0 ? x0 - 14 : x0 + (mark.fret - 0.5) * fw;
    root.append(svg('circle', { cx, cy: yOf(mark.string), r: 15, fill: mark.color || '#f2c418', stroke: '#fff', 'stroke-width': 2 }));
    if (mark.label) {
      const t = svg('text', { x: cx, y: yOf(mark.string) + 5, fill: '#111', 'font-size': 13, 'font-weight': 800, 'text-anchor': 'middle' });
      t.textContent = mark.label;
      root.append(t);
    }
  }
  return root;
}

export function createNoteTrainerUI(trainer, { engine, getTuning, onDone }) {
  const el = h('div', { class: 'dialog trainer', hidden: true });
  const box = h('div', { class: 'dialog-box' });
  el.append(box);
  document.body.append(el);
  const opts = { mode: 'find', count: 20, maxFret: 12, naturalsOnly: true };

  function setup() {
    const tabs = [['find', 'Find the note'], ['name', 'Name the fret']];
    box.replaceChildren(
      h('h2', {}, 'Fretboard trainer'),
      h('p', { class: 'small' }, 'Learn where the notes are. The trainer listens and checks each answer (the string decides the octave, so play it on the string asked).'),
      h('div', { class: 'tabs' }, ...tabs.map(([k, label]) => h('button', { class: `btn${opts.mode === k ? ' on' : ''}`, onclick: () => { opts.mode = k; setup(); } }, label))),
      h('p', { class: 'small' }, opts.mode === 'find' ? '"Play G on the A string": find it and play it.' : 'A fret lights up on the diagram: play it, then the trainer tells you which note it was.'),
      h('div', { class: 'drill-opts' },
        h('label', {}, 'Questions ', h('select', { onchange: (e) => { opts.count = Number(e.target.value); } }, [10, 20, 30].map((n) => h('option', { value: n, selected: n === opts.count }, String(n))))),
        h('label', {}, 'Frets ', h('select', { onchange: (e) => { opts.maxFret = Number(e.target.value); } }, [[5, '0–5'], [7, '0–7'], [12, '0–12']].map(([n, l]) => h('option', { value: n, selected: n === opts.maxFret }, l)))),
        h('label', {}, h('input', { type: 'checkbox', checked: opts.naturalsOnly, onchange: (e) => { opts.naturalsOnly = e.target.checked; } }), ' Natural notes only (no sharps)')),
      engine.running ? null : h('p', { class: 'warnline' }, 'Start the input in the BASS TRAINER panel first, so the trainer can hear you.'),
      h('div', { class: 'dialog-row' },
        h('button', { class: 'btn', onclick: close }, 'Close'),
        h('button', { class: 'btn primary', onclick: () => { trainer.start({ ...opts, tuning: getTuning() }); } }, 'Start')));
  }

  function question(r) {
    const q = r.q;
    const stringName = NOTE_NAMES[r.tuning[q.string] % 12];
    const showMark = r.mode === 'name' || (r.feedback && r.feedback.ok);
    const label = r.feedback && r.feedback.ok ? q.name : r.mode === 'name' ? '?' : '';
    box.replaceChildren(
      h('div', { class: 'tq-head' }, h('span', { class: 'small' }, `Question ${r.n} of ${r.count}`), h('span', { class: 'small' }, `${r.firstTry} right first time${r.streak >= 3 ? ` · streak ${r.streak}` : ''}`)),
      h('div', { class: 'tq' }, r.mode === 'find'
        ? [h('span', {}, 'Play '), h('b', {}, q.name), h('span', {}, ' on the '), h('b', { style: { color: stringColors(r.tuning.length)[q.string] } }, stringName), h('span', {}, ' string')]
        : [h('span', {}, 'Play the marked fret: '), h('b', { style: { color: stringColors(r.tuning.length)[q.string] } }, `${stringName} string`), h('span', {}, `, ${q.fret === 0 ? 'open' : `fret ${q.fret}`}`)]),
      fretboard(r.tuning, r.maxFret, showMark ? { string: q.string, fret: q.fret, label, color: r.feedback && r.feedback.ok ? '#5fd38d' : '#f2c418' } : null),
      h('div', { class: `tfb ${r.feedback ? (r.feedback.ok ? 'ok' : 'no') : ''}` }, r.feedback ? (r.feedback.ok && r.mode === 'name' ? `${r.feedback.text} It's ${q.name}.` : r.feedback.text) : engine.running ? 'Listening…' : 'Start the input in the panel so the trainer can hear you.'),
      h('div', { class: 'dialog-row' },
        h('button', { class: 'btn', onclick: () => { trainer.stop(); setup(); } }, 'Stop'),
        h('button', { class: 'btn', title: 'Show the answer and go on (counts as missed)', onclick: () => { r.tries++; trainer.next(); } }, 'Skip')));
  }

  function done(r) {
    const avg = r.times.length ? (r.times.reduce((a, x) => a + x, 0) / r.times.length).toFixed(1) : '–';
    box.replaceChildren(
      h('h2', {}, 'Round complete'),
      h('div', { class: 'tq' }, h('b', {}, `${Math.round((r.firstTry / r.count) * 100)}%`), h('span', {}, ` right the first time (${r.firstTry} of ${r.count})`)),
      h('p', {}, `Average answer time: ${avg} s · best streak ${r.bestStreak}`),
      h('p', { class: 'small' }, 'Saved in your Library under Drills → Fretboard trainer.'),
      h('div', { class: 'dialog-row' },
        h('button', { class: 'btn', onclick: close }, 'Close'),
        h('button', { class: 'btn', onclick: setup }, 'Change settings'),
        h('button', { class: 'btn primary', onclick: () => trainer.start({ ...opts, tuning: getTuning() }) }, 'Again')));
  }

  trainer.onChange((t, ev) => {
    if (el.hidden) return;
    const r = t.round;
    if (!r) return;
    if (ev && ev.type === 'done') { onDone(t.record()); done(r); } else question(r);
  });
  engine.on('state', () => { if (!el.hidden && !trainer.round) setup(); });

  function open() { setup(); el.hidden = false; }
  function close() { trainer.stop(); el.hidden = true; }
  return { open, close };
}
