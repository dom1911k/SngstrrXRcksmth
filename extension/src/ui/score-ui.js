// Scoring UI inside the highway overlay: live accuracy/streak, hit/miss
// labels on the highway, a short toast after each loop pass and a summary
// card at the end of the song.
import { h } from './dom.js';
import { getSettings, updateSettings } from '../core/settings.js';

export const SCORE_CSS = `
.score { position: absolute; top: 6px; left: 50%; transform: translateX(-50%); z-index: 3; pointer-events: none;
  display: flex; gap: 18px; align-items: baseline; font: 700 18px system-ui, "Segoe UI", sans-serif; text-shadow: 0 1px 3px #000; }
.score[hidden] { display: none; }
.score .acc { color: #fff; font-size: 22px; }
.score .streak { color: #f2c418; }
.score .last { color: #9aa0aa; font-size: 14px; font-weight: 600; min-width: 90px; }
.hint { position: absolute; top: 8px; left: 50%; transform: translateX(-50%); z-index: 3; color: #ffb347; font: 600 14px system-ui; text-shadow: 0 1px 3px #000; }
.hint[hidden] { display: none; }
.toast { position: absolute; top: 44px; left: 50%; transform: translateX(-50%); z-index: 4; background: rgba(16,18,24,.94);
  border: 1px solid #3a3f49; border-radius: 10px; padding: 8px 14px; font: 600 14px system-ui; color: #e8e8ea; display: flex; gap: 12px; align-items: center; }
.toast[hidden] { display: none; }
.toast b { font-size: 18px; }
.toast button, .card button { background: #2a2e36; color: #fff; border: 1px solid #3a3f49; border-radius: 6px; padding: 4px 10px; font: 600 12px system-ui; cursor: pointer; }
.toast button.primary, .card button.primary { background: #e8202a; border-color: #e8202a; }
.card { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); z-index: 5; width: min(520px, 92%); max-height: 92%; overflow: auto;
  background: rgba(16,18,24,.97); border: 1px solid #3a3f49; border-radius: 12px; padding: 16px 20px; font: 14px/1.45 system-ui, "Segoe UI", sans-serif; color: #e8e8ea; }
.card[hidden] { display: none; }
.card h3 { margin: 0 0 8px; color: #f2c418; font-size: 16px; }
.card .big { font-size: 40px; font-weight: 800; }
.card .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin: 10px 0; text-align: center; }
.card .grid div { background: #0e1014; border-radius: 8px; padding: 6px; }
.card .grid b { display: block; font-size: 18px; }
.card .muted { color: #8b919c; font-size: 12px; }
.card ul { margin: 4px 0 10px 18px; padding: 0; }
.card .row { display: flex; gap: 8px; justify-content: flex-end; margin-top: 10px; flex-wrap: wrap; }
.card .tip { background: #2b2410; border: 1px solid #4a3d12; color: #f2c418; border-radius: 8px; padding: 8px 10px; margin: 8px 0; }
`;

const pct = (x) => (x === null || x === undefined ? '–' : `${Math.round(x * 100)}%`);

export function createScoreUI(wrap, session, getHighway) {
  const acc = h('span', { class: 'acc' }, '–');
  const streak = h('span', { class: 'streak' }, '');
  const last = h('span', { class: 'last' }, '');
  const score = h('div', { class: 'score', hidden: true }, acc, streak, last);
  const hint = h('div', { class: 'hint', hidden: true }, 'Start the input in the BASS TRAINER panel to score your playing');
  const toast = h('div', { class: 'toast', hidden: true });
  const card = h('div', { class: 'card', hidden: true });
  wrap.append(score, hint, toast, card);
  let toastTimer = null;
  let lastSummary = null;

  function renderStats(st) {
    if (!st) return;
    acc.textContent = st.judged ? `${pct(st.accuracy)}` : '–';
    streak.textContent = st.streak >= 2 ? `streak ${st.streak}` : '';
  }

  session.on('stats', renderStats);
  session.on('result', (r) => {
    const s = getSettings();
    if (s.showFeedback) {
      const hw = getHighway();
      if (hw && hw.feedback) hw.feedback(r);
    }
    last.textContent = r.status === 'hit'
      ? (r.rating === 'ontime' ? `on time` : `${r.rating} ${Math.abs(r.offsetMs)} ms`)
      : r.playedName ? `played ${r.playedName}, not ${r.expectedName}` : 'missed';
  });
  session.on('pass', () => { renderStats(session.stats()); });

  session.on('summary', (s) => {
    lastSummary = s;
    if (s.kind === 'loop') showToast(s);
    else showCard(s);
  });

  function showToast(s) {
    toast.replaceChildren(
      h('span', {}, 'Loop pass'), h('b', {}, pct(s.accuracy)),
      h('span', { class: 'muted' }, `${s.hits}/${s.judged} · best streak ${s.bestStreak}`),
      h('button', { onclick: () => { toast.hidden = true; showCard(s); } }, 'Details'));
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, 5000);
  }

  function showCard(s) {
    const timed = s.early + s.ontime + s.late;
    const off = s.avgOffsetMs;
    const tip = timed >= 8 && Math.abs(off) >= 15
      ? h('div', { class: 'tip' },
        `Your hits were on average ${Math.abs(off)} ms ${off > 0 ? 'late' : 'early'}. If you felt in time, adjust the timing correction by ${off > 0 ? '+' : ''}${off} ms. `,
        h('button', { class: 'primary', onclick: (e) => {
          const cur = getSettings().fineTuneMs || 0;
          updateSettings({ fineTuneMs: Math.max(-150, Math.min(150, cur + off)) });
          e.target.textContent = 'Applied';
          e.target.disabled = true;
        } }, 'Apply'))
      : null;
    card.replaceChildren(...[
      h('h3', {}, s.kind === 'loop' ? 'Loop pass' : 'Song finished'),
      h('div', {}, h('span', { class: 'big' }, pct(s.accuracy)), h('span', { class: 'muted' }, `  ${s.hits} of ${s.judged} notes · best streak ${s.bestStreak}`)),
      h('div', { class: 'grid' },
        h('div', {}, h('b', {}, s.early), h('span', { class: 'muted' }, 'early')),
        h('div', {}, h('b', {}, s.ontime), h('span', { class: 'muted' }, 'on time')),
        h('div', {}, h('b', {}, s.late), h('span', { class: 'muted' }, 'late')),
        h('div', {}, h('b', {}, s.misses), h('span', { class: 'muted' }, 'missed'))),
      h('div', { class: 'muted' }, `Average timing: ${off > 0 ? '+' : ''}${off} ms (+ = late)${s.octave ? ` · ${s.octave} octave-ambiguous hits` : ''}`),
      tip,
      s.weakBars && s.weakBars.length ? h('div', {}, h('b', {}, 'Bars to practise'),
        h('ul', {}, ...s.weakBars.map((b) => h('li', {}, `Bar ${b.number}${b.section ? ` (${b.section})` : ''}: ${b.misses} missed`)))) : null,
      s.wrongNotes && s.wrongNotes.length ? h('div', {}, h('b', {}, 'Different notes than the tab'),
        h('ul', {}, ...s.wrongNotes.map((w) => h('li', {}, `Played ${w.played} instead of ${w.expected} ×${w.count} (bar ${w.bars.join(', ')})`))),
        h('div', { class: 'muted' }, 'If you are sure you played these right (same mistake every time, by ear), the tab may be wrong here.')) : null,
      h('div', { class: 'row' }, h('button', { class: 'primary', onclick: () => { card.hidden = true; } }, 'Close')),
    ].filter(Boolean));
    card.hidden = false;
  }

  // Live state (cheap; called every frame by the overlay).
  function update(chartLoaded) {
    const active = session.active;
    const s = getSettings();
    score.hidden = !active || !s.scoring;
    hint.hidden = active || !chartLoaded || !s.scoring || session.engine.running;
  }

  // Hide the card when playback resumes.
  session.adapter.on('play', () => { card.hidden = true; });

  return { update, showLast: () => { const s = lastSummary || session.currentSummary(); if (s) showCard(s); } };
}
