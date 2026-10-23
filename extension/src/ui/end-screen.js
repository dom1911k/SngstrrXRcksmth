// Rocksmith-style screens in the highway overlay:
//  * end of song: big animated accuracy, personal best, streak, timing, and one
//    block per section coloured by how well you played it;
//  * session report: shown when you stop the input.
import { h } from './dom.js';
import { sectionsOf } from '../core/history.js';
import { accuracyColor } from './progress-ui.js';

export const END_CSS = `
.endscreen { position: absolute; inset: 0; z-index: 6; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px;
  background: radial-gradient(ellipse at 50% 40%, rgba(20,26,48,.93), rgba(4,5,10,.97) 70%); color: #e8e8ea; font-family: system-ui, "Segoe UI", sans-serif;
  animation: endIn .35s ease-out; padding: 20px; overflow: auto; }
.endscreen[hidden] { display: none; }
@keyframes endIn { from { opacity: 0; } to { opacity: 1; } }
.endscreen .kicker { letter-spacing: .3em; font-size: 13px; color: #9aa6c8; font-weight: 700; }
.endscreen .song { font-size: 22px; font-weight: 700; text-align: center; }
.endscreen .song span { color: #8b919c; font-weight: 500; }
.endscreen .acc { font-size: 96px; font-weight: 900; line-height: 1; font-variant-numeric: tabular-nums; text-shadow: 0 0 30px rgba(242,196,24,.35); }
.endscreen .acc small { font-size: 40px; }
.endscreen .best { font-size: 14px; color: #9aa0aa; min-height: 22px; }
.endscreen .newbest { display: inline-block; background: #f2c418; color: #111; font-weight: 900; letter-spacing: .12em; padding: 3px 12px; border-radius: 6px;
  animation: pop .5s cubic-bezier(.2,1.6,.4,1) both; animation-delay: 1.2s; }
@keyframes pop { from { transform: scale(.3); opacity: 0; } to { transform: scale(1); opacity: 1; } }
.endscreen .stats { display: flex; gap: 26px; margin: 4px 0 6px; }
.endscreen .stats div { text-align: center; }
.endscreen .stats b { display: block; font-size: 24px; font-variant-numeric: tabular-nums; }
.endscreen .stats span { font-size: 12px; color: #8b919c; }
.endscreen .secs { display: flex; gap: 3px; width: min(860px, 94%); }
.endscreen .sec { flex: 1; min-width: 0; height: 46px; border-radius: 5px; display: flex; flex-direction: column; justify-content: flex-end; padding: 4px 6px;
  font-size: 11px; font-weight: 700; color: #fff; text-shadow: 0 1px 2px #000; overflow: hidden; white-space: nowrap; opacity: 0; animation: secIn .4s ease-out forwards; }
.endscreen .sec em { font-style: normal; font-size: 13px; }
@keyframes secIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
.endscreen .row { display: flex; gap: 8px; margin-top: 12px; flex-wrap: wrap; justify-content: center; }
.endscreen button { background: #2a2e36; color: #fff; border: 1px solid #3a3f49; border-radius: 8px; padding: 8px 16px; font: 600 14px system-ui; cursor: pointer; }
.endscreen button.primary { background: #e8202a; border-color: #e8202a; }
.endscreen .hl { color: #f2c418; font-size: 15px; text-align: center; }
.endscreen table { border-collapse: collapse; font-size: 14px; min-width: min(560px, 92%); }
.endscreen td { padding: 5px 10px; border-bottom: 1px solid #23262c; }
.endscreen td.r { text-align: right; font-variant-numeric: tabular-nums; }
.endscreen .up { color: #5fd38d; }
`;

const pct = (x) => (x === null || x === undefined ? '–' : `${Math.round(x * 100)}%`);
const mins = (s) => (s < 60 ? `${Math.round(s)} s` : `${Math.round(s / 60)} min`);

export function createEndScreen(wrap, { adapter, history = null, onDetails = null, loopBars = null } = {}) {
  const el = h('div', { class: 'endscreen', hidden: true });
  wrap.append(el);
  let anim = null;

  function hide() { el.hidden = true; cancelAnimationFrame(anim); }
  adapter.on('play', hide);

  function countUp(node, target) {
    const t0 = performance.now();
    const step = () => {
      const k = Math.min(1, (performance.now() - t0) / 1200);
      const v = Math.round(target * 100 * (1 - Math.pow(1 - k, 3)));
      node.firstChild.textContent = String(v);
      if (k < 1) anim = requestAnimationFrame(step);
    };
    anim = requestAnimationFrame(step);
  }

  async function showSong(s) {
    const chart = adapter.getChart();
    if (!chart) return;
    // Previous best at full speed (before this run).
    let prevBest = null;
    if (history) {
      try {
        const { records } = await history.load(chart);
        const earlier = records.filter((r) => r.at < (s.at || Date.now()) - 1 && (r.speed || 1) >= 0.999);
        if (earlier.length) prevBest = Math.max(...earlier.map((r) => r.accuracy || 0));
      } catch { /* no history */ }
    }
    const full = (s.speed || 1) >= 0.999;
    const isBest = full && s.accuracy !== null && (prevBest === null || s.accuracy > prevBest + 0.005);
    // Accuracy per section from this run's bars.
    const perBar = new Map((s.perBar || []).map((b) => [b.bar, b]));
    const secs = sectionsOf(chart).map((sec) => {
      let hits = 0, n = 0;
      for (let i = sec.firstBar; i <= sec.lastBar; i++) { const b = perBar.get(i); if (b) { hits += b.hits; n += b.hits + b.misses; } }
      return { ...sec, acc: n ? hits / n : null };
    }).filter((x) => x.acc !== null);
    const weakest = secs.length ? [...secs].sort((a, b) => a.acc - b.acc)[0] : null;
    const timed = s.early + s.ontime + s.late;
    const accEl = h('div', { class: 'acc' }, '0', h('small', {}, '%'));
    el.replaceChildren(...[
      h('div', { class: 'kicker' }, 'SONG COMPLETE'),
      h('div', { class: 'song' }, chart.meta.title || '', chart.meta.artist ? h('span', {}, ` · ${chart.meta.artist}`) : null),
      accEl,
      h('div', { class: 'best' }, isBest ? h('span', { class: 'newbest' }, prevBest === null ? 'FIRST SCORE' : 'NEW BEST!')
        : full ? `Your best: ${pct(prevBest)}` : `Played at ${Math.round(s.speed * 100)}% speed${prevBest !== null ? ` · best at full speed ${pct(prevBest)}` : ''}`),
      h('div', { class: 'stats' },
        h('div', {}, h('b', {}, `${s.hits}/${s.judged}`), h('span', {}, 'notes hit')),
        h('div', {}, h('b', {}, s.bestStreak), h('span', {}, 'longest streak')),
        h('div', {}, h('b', {}, timed ? pct(s.ontime / timed) : '–'), h('span', {}, 'on time')),
        h('div', {}, h('b', {}, `${s.avgOffsetMs > 0 ? '+' : ''}${s.avgOffsetMs} ms`), h('span', {}, 'average timing'))),
      secs.length > 1 ? h('div', { class: 'secs' }, ...secs.map((x, i) => h('div', {
        class: 'sec', title: `${x.name}: ${pct(x.acc)}`,
        style: { background: accuracyColor(x.acc, 0.85), flexGrow: String(Math.max(1, x.lastBar - x.firstBar + 1)), animationDelay: `${0.3 + i * 0.07}s` },
      }, h('em', {}, pct(x.acc)), x.name))) : null,
      h('div', { class: 'row' },
        h('button', { class: 'primary', onclick: () => { hide(); adapter.seek(0); adapter.play(); } }, 'Play again'),
        weakest && loopBars && weakest.acc < 0.98 ? h('button', { onclick: () => { hide(); loopBars(weakest.firstBar, weakest.lastBar); } }, `Practise "${weakest.name}" (${pct(weakest.acc)})`) : null,
        onDetails ? h('button', { onclick: () => { hide(); onDetails(s); } }, 'Details') : null,
        h('button', { onclick: hide }, 'Close')),
    ].filter(Boolean));
    el.hidden = false;
    countUp(accEl, s.accuracy || 0);
  }

  function showSession(r, { onLibrary = null } = {}) {
    el.replaceChildren(...[
      h('div', { class: 'kicker' }, 'SESSION REPORT'),
      h('div', { class: 'song' }, new Date(r.start).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })),
      h('div', { class: 'stats' },
        h('div', {}, h('b', {}, mins(r.wallSeconds)), h('span', {}, 'session')),
        h('div', {}, h('b', {}, mins(r.practiceSeconds)), h('span', {}, 'playing')),
        h('div', {}, h('b', {}, r.passes), h('span', {}, 'passes')),
        h('div', {}, h('b', {}, r.notes), h('span', {}, 'notes')),
        h('div', {}, h('b', {}, pct(r.accuracy)), h('span', {}, 'accuracy'))),
      ...r.highlights.slice(0, 4).map((t) => h('div', { class: 'hl' }, `★ ${t}`)),
      h('table', {}, ...r.songs.map((x) => h('tr', {},
        h('td', {}, x.title),
        h('td', { class: 'r' }, `${x.passes} pass${x.passes === 1 ? '' : 'es'}`),
        h('td', { class: 'r' }, mins(x.seconds)),
        h('td', { class: 'r' }, x.bestBpm ? `${x.bestBpm} BPM` : `best ${pct(x.bestFull ?? x.best)}`),
        h('td', { class: `r ${x.newBest ? 'up' : ''}` }, x.newBest ? '↑ new best' : x.prevBest !== null && x.prevBest !== undefined ? `prev ${pct(x.prevBest)}` : '')))),
      h('div', { class: 'row' },
        onLibrary ? h('button', { onclick: () => { hide(); onLibrary(); } }, 'Open library') : null,
        h('button', { class: 'primary', onclick: hide }, 'Close')),
    ].filter(Boolean));
    el.hidden = false;
  }

  return { showSong, showSession, hide, get visible() { return !el.hidden; } };
}
