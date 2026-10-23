// Practice history in the highway overlay: a "Progress & weak spots" card and
// the section strip at the top of the highway (Rocksmith's phrase bar): one
// block per section, coloured by how well you play it, small marks on bars
// you often miss, the loop range and where you are. Click a section to jump
// there, double-click to loop it.
import { h } from './dom.js';
import { getSettings, updateSettings } from '../core/settings.js';
import { sectionsOf } from '../core/history.js';
import { loopBars } from '../core/riff-repeater.js';

export const PROGRESS_CSS = `
.secbar { position: absolute; top: 0; left: 0; right: 0; height: 18px; z-index: 3; cursor: pointer; }
.secbar[hidden] { display: none; }
.secbar canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
.card .bars { display: flex; align-items: flex-end; gap: 3px; height: 54px; margin: 6px 0 2px; }
.card .bars div { flex: 1; background: #f2c418; border-radius: 2px 2px 0 0; min-height: 2px; }
.card .sec { display: grid; grid-template-columns: 1fr 120px 44px auto; gap: 8px; align-items: center; margin: 3px 0; font-size: 13px; }
.card .meterbar { height: 8px; background: #0e1014; border-radius: 4px; overflow: hidden; }
.card .meterbar i { display: block; height: 100%; }
.card table { width: 100%; border-collapse: collapse; font-size: 13px; }
.card td { padding: 3px 4px; border-bottom: 1px solid #23262c; }
.card td.r { text-align: right; }
.card button.small { padding: 2px 8px; font-size: 11px; }
`;

const pct = (x) => (x === null || x === undefined ? '–' : `${Math.round(x * 100)}%`);

// Red (bad) -> yellow -> green (good).
export function accuracyColor(acc, alpha = 1) {
  if (acc === null || acc === undefined) return `rgba(80,88,104,${alpha})`;
  const a = Math.max(0, Math.min(1, (acc - 0.5) / 0.5));
  const r = a < 0.5 ? 232 : Math.round(232 - (a - 0.5) * 2 * (232 - 70));
  const g = a < 0.5 ? Math.round(60 + a * 2 * (196 - 60)) : 196 + Math.round((a - 0.5) * 2 * (200 - 196));
  const b = a < 0.5 ? 60 : 80;
  return `rgba(${r},${g},${b},${alpha})`;
}

export function createProgressUI(wrap, { adapter, history, notify = () => {}, riff = null }) {
  const card = h('div', { class: 'card', hidden: true });
  const canvas = h('canvas');
  const strip = h('div', { class: 'secbar', title: 'Sections. Click: jump there · double-click: loop it' }, canvas);
  wrap.append(strip, card);
  let chart = null;
  let sections = [];
  let stats = null;     // aggregate() of this song's history
  let span = [0, 1];    // song time range of the strip

  async function refresh() {
    if (!chart) { stats = null; return; }
    try { stats = (await history.load(chart)).stats; } catch { stats = null; }
  }

  adapter.on('chart', (info) => {
    chart = info && info.isBassLike ? info.chart : null;
    sections = chart ? sectionsOf(chart) : [];
    stats = null;
    refresh();
  });
  history.onSaved(() => refresh());

  // ---------- section strip ----------
  const xOf = (t, w) => ((t - span[0]) / (span[1] - span[0])) * w;
  const tOf = (x, w) => span[0] + (x / w) * (span[1] - span[0]);

  function sectionAtX(e) {
    const r = canvas.getBoundingClientRect();
    const t = tOf(e.clientX - r.left, r.width);
    return sections.find((s) => t >= s.t && t < s.end) || null;
  }
  let clickTimer = null;
  strip.addEventListener('click', (e) => {
    const sec = sectionAtX(e);
    if (!sec) return;
    clearTimeout(clickTimer);
    clickTimer = setTimeout(() => { adapter.seek(sec.t); notify(sec.name); }, 220);
  });
  strip.addEventListener('dblclick', (e) => {
    clearTimeout(clickTimer);
    const sec = sectionAtX(e);
    if (sec) loopBars(adapter, sec.firstBar, sec.lastBar, notify);
  });

  function drawStrip(time, loop) {
    const show = getSettings().showSectionBar && sections.length > 0;
    strip.hidden = !show;
    if (!show) return;
    const w = canvas.clientWidth, hgt = canvas.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(hgt * dpr)) {
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(hgt * dpr);
    }
    const g = canvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, hgt);
    span = [sections[0].t, sections[sections.length - 1].end];
    const secStats = new Map(stats ? stats.sections.map((s) => [s.firstBar, s]) : []);
    g.font = '600 10px system-ui, "Segoe UI", sans-serif';
    g.textBaseline = 'middle';
    for (const sec of sections) {
      const x0 = xOf(sec.t, w), x1 = xOf(sec.end, w);
      const st = secStats.get(sec.firstBar);
      const playing = time >= sec.t && time < sec.end;
      g.fillStyle = st && st.accuracy !== null ? accuracyColor(st.accuracy, playing ? 0.55 : 0.32) : playing ? 'rgba(120,130,150,.45)' : 'rgba(60,66,80,.55)';
      g.fillRect(x0 + 0.5, 1, Math.max(1, x1 - x0 - 1), hgt - 5);
      if (x1 - x0 > 26) {
        g.save();
        g.beginPath(); g.rect(x0 + 2, 0, x1 - x0 - 4, hgt); g.clip();
        g.fillStyle = playing ? '#ffffff' : '#c3c8d2';
        g.fillText(sec.name, x0 + 4, (hgt - 4) / 2 + 1);
        g.restore();
      }
    }
    // Weak bars: small red marks along the bottom.
    if (stats && chart) {
      for (const b of stats.barStats) {
        if (b.missRate < 0.2 || b.hits + b.misses < 3 || b.t === null) continue;
        g.fillStyle = `rgba(255,70,70,${Math.min(1, 0.35 + b.missRate)})`;
        const x0 = xOf(b.t, w), x1 = xOf(b.end, w);
        g.fillRect(x0, hgt - 4, Math.max(2, x1 - x0), 3);
      }
    }
    if (loop) {
      g.strokeStyle = '#f2c418';
      g.lineWidth = 1.5;
      g.strokeRect(xOf(loop.start, w) + 0.5, 0.75, Math.max(2, xOf(loop.end, w) - xOf(loop.start, w) - 1), hgt - 2);
    }
    const cx = xOf(time, w);
    g.fillStyle = '#ffffff';
    g.fillRect(Math.round(cx) - 1, 0, 2, hgt);
  }

  // ---------- card ----------
  async function show() {
    await refresh();
    const st = stats;
    const title = chart && chart.meta ? `${chart.meta.artist ? chart.meta.artist + ' – ' : ''}${chart.meta.title}` : '';
    if (!chart) { card.replaceChildren(h('h3', {}, 'Progress'), h('div', {}, 'Open a bass track first.'), closeRow()); card.hidden = false; return; }
    if (!st || !st.passes) {
      card.replaceChildren(h('h3', {}, `Progress · ${title}`),
        h('div', {}, 'No practice saved for this song yet. Start the input and play: every pass (the whole song, each loop pass, or a good part before you jump away) is saved here.'),
        closeRow());
      card.hidden = false;
      return;
    }
    const days = st.days.slice(-14);
    const loopBtn = (first, last, label = 'Loop') => h('button', { class: 'small', onclick: () => { loopBars(adapter, first, last, notify); card.hidden = true; } }, label);
    const riffBtn = (first, last) => riff ? h('button', { class: 'small primary', title: 'Loop it and speed up automatically', onclick: () => {
      loopBars(adapter, first, last, notify);
      if (!getSettings().riffRepeater) updateSettings({ riffRepeater: true }); else riff.begin();
      card.hidden = true;
    } }, 'Riff repeater') : null;
    card.replaceChildren(...[
      h('h3', {}, `Progress · ${title}`),
      h('div', { class: 'grid' },
        h('div', {}, h('b', {}, st.passes), h('span', { class: 'muted' }, 'passes')),
        h('div', {}, h('b', {}, st.fullPlays), h('span', { class: 'muted' }, 'full plays')),
        h('div', {}, h('b', {}, pct(st.bestFull)), h('span', { class: 'muted' }, 'best at 100%')),
        h('div', {}, h('b', {}, pct(st.last ? st.last.accuracy : null)), h('span', { class: 'muted' }, 'last pass'))),
      days.length > 1 ? h('div', {}, h('b', {}, 'Accuracy per day'),
        h('div', { class: 'bars' }, ...days.map((d) => h('div', { title: `${d.day}: ${pct(d.accuracy)} over ${d.passes} passes`, style: { height: `${Math.max(3, (d.accuracy || 0) * 100)}%`, background: accuracyColor(d.accuracy) } }))),
        h('div', { class: 'muted' }, `${days[0].day} – ${days[days.length - 1].day}`)) : null,
      st.sections.length > 1 ? h('div', {}, h('b', {}, 'Sections'),
        ...st.sections.map((s) => h('div', { class: 'sec' },
          h('span', {}, s.name, h('span', { class: 'muted' }, ` bars ${chart.bars[s.firstBar].measure + 1}–${chart.bars[s.lastBar].measure + 1}`)),
          h('div', { class: 'meterbar' }, h('i', { style: { width: `${Math.round((s.accuracy || 0) * 100)}%`, background: accuracyColor(s.accuracy) } })),
          h('span', {}, pct(s.accuracy)),
          loopBtn(s.firstBar, s.lastBar)))) : null,
      st.weakBars.length ? h('div', {}, h('b', {}, 'Weak spots (bars you miss most)'),
        h('table', {}, ...st.weakBars.map((b) => h('tr', {},
          h('td', {}, `Bar ${b.number}`, b.section ? h('span', { class: 'muted' }, ` · ${b.section}`) : null),
          h('td', { class: 'r' }, `${Math.round(b.missRate * 100)}% missed`),
          h('td', { class: 'r muted' }, `${b.hits + b.misses} notes`),
          h('td', { class: 'r' }, loopBtn(Math.max(0, b.bar - 1), Math.min(chart.bars.length - 1, b.bar + 1), 'Loop ±1 bar'), ' ', riffBtn(b.bar, b.bar))))),
        h('div', { class: 'muted' }, 'Recent passes count more, so bars you have fixed drop off the list.')) : h('div', { class: 'muted' }, 'No weak spots yet.'),
      h('div', { class: 'row' },
        h('button', { onclick: async (e) => {
          if (e.target.dataset.confirm !== '1') { e.target.dataset.confirm = '1'; e.target.textContent = 'Click again to delete'; return; }
          await history.clear(chart);
          await refresh();
          card.hidden = true;
          notify('History of this song deleted');
        } }, 'Delete history of this song'),
        h('button', { class: 'primary', onclick: () => { card.hidden = true; } }, 'Close')),
    ].filter(Boolean));
    card.hidden = false;
  }

  function closeRow() {
    return h('div', { class: 'row' }, h('button', { class: 'primary', onclick: () => { card.hidden = true; } }, 'Close'));
  }

  adapter.on('play', () => { card.hidden = true; });

  return { show, update: drawStrip, refresh, get visible() { return !strip.hidden; } };
}
