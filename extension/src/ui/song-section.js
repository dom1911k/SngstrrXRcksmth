// Panel section "Song & highway": connection status, track, tab tuning,
// highway settings and chart export.
import { h } from './dom.js';
import { getSettings, updateSettings } from '../core/settings.js';
import { tuningName } from '../core/music.js';

export function createSongSection(adapter, { onTabTuning, showSummary = null }) {
  const s = getSettings();
  const statusEl = h('div', {}, 'Connecting to Songsterr…');
  const trackEl = h('div', { class: 'muted' });
  const warnEl = h('div', { class: 'warn' });
  const exportBtn = h('button', { class: 'btn', disabled: true, onclick: () => exportChart() }, 'Download chart (JSON)');

  const slider = (key, min, max, step, fmt) => {
    const val = h('span', { class: 'muted' }, fmt(s[key]));
    const input = h('input', { type: 'range', min, max, step, value: s[key], oninput: () => {
      const v = Number(input.value);
      val.textContent = fmt(v);
      updateSettings({ [key]: v });
    } });
    return [h('div', { class: 'grow' }, input), val];
  };
  const select = (key, options, cast = String) => h('select', { onchange: (e) => updateSettings({ [key]: cast(e.target.value) }) },
    options.map(([v, label]) => h('option', { value: v, selected: s[key] === v }, label)));
  const check = (key, label) => h('label', { class: 'row muted' },
    h('input', { type: 'checkbox', checked: s[key], onchange: (e) => updateSettings({ [key]: e.target.checked }) }), label);

  const section = h('section', {},
    h('h2', {}, 'Song & highway'),
    statusEl, trackEl, warnEl,
    h('div', { class: 'row' }, h('span', { class: 'muted' }, 'Highway timing'),
      ...slider('visualDelayMs', -100, 300, 5, (v) => `${v} ms`)),
    h('div', { class: 'muted' }, 'Move until notes cross the strings exactly when you hear them (the wireless headset makes sound arrive later than the picture).'),
    h('div', { class: 'row' }, h('span', { class: 'muted' }, 'Note speed'),
      ...slider('lookahead', 1.5, 6, 0.1, (v) => `${Number(v).toFixed(1)} s ahead`)),
    h('div', { class: 'muted' }, 'How long a note is visible before you play it. Higher = see further ahead, notes move slower.'),
    check('gemFretNumbers', 'Fret numbers on the notes (3D)'),
    check('invertStrings', 'Tab order (G on top) instead of Rocksmith order (E on top)'),
    check('showSectionBar', 'Section strip with your weak spots at the top of the highway'),
    check('showDebug', 'Show sync diagnostics on the highway'),
    h('div', { class: 'row' }, exportBtn,
      adapter.name === 'Songsterr player' && typeof chrome !== 'undefined' && chrome.runtime
        ? h('button', { class: 'btn', title: 'Practise with your own audio file and a chart', onclick: () => chrome.runtime.sendMessage({ type: 'openPlayer' }) }, 'Open standalone player')
        : null),
  );

  const scoringSection = h('section', {},
    h('h2', {}, 'Scoring'),
    check('scoring', 'Score my playing (needs the input started below)'),
    check('showLiveScore', 'Show accuracy and streak above the highway while playing'),
    check('autoTiming', 'Automatic timing correction (learns small, constant early/late offsets while you play)'),
    h('div', { class: 'row' }, h('span', { class: 'muted' }, 'Timing window'),
      select('hitWindowMs', [[70, 'Strict (±70 ms)'], [110, 'Normal (±110 ms)'], [160, 'Relaxed (±160 ms)']], Number)),
    h('div', { class: 'row' }, h('span', { class: 'muted' }, 'Dead notes (x)'),
      select('deadNotes', [['attack', 'any muted attack counts'], ['ignore', 'not scored']])),
    showSummary ? h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => showSummary() }, 'Show summary of the current pass')) : null,
  );

  let lastInfo = null;

  adapter.on('status', (st) => {
    statusEl.className = st.state === 'ok' ? 'good' : st.state === 'error' ? 'bad' : 'muted';
    statusEl.textContent = st.state === 'ok' ? `Connected to the ${adapter.name || 'player'}.` : st.detail;
  });

  adapter.on('chart', (info) => {
    lastInfo = info;
    exportBtn.disabled = !info.chart;
    if (info.error && !info.chart) {
      trackEl.textContent = info.error;
      return;
    }
    const tr = info.track ? `${info.track.instrument}${info.track.name ? ' · ' + info.track.name : ''}` : '';
    const c = info.chart;
    trackEl.textContent = `${info.artist} – ${info.title}. ${tr}${c ? ` · ${c.notes.length} notes · tuning ${tuningName(c.instrument.tuning)}` : ''}`;
    warnEl.replaceChildren(...[
      !info.isBassLike ? h('div', {}, 'The displayed track is not a bass part. Use the buttons on the highway to switch.') : null,
      ...(info.warnings || []).map((w) => h('div', {}, w)),
    ].filter(Boolean));
    if (c && info.isBassLike) onTabTuning(c.instrument.tuning);
  });

  function exportChart() {
    if (!lastInfo || !lastInfo.chart) return;
    const c = lastInfo.chart;
    const blob = new Blob([JSON.stringify(c, null, 1)], { type: 'application/json' });
    const a = h('a', { href: URL.createObjectURL(blob), download: `${c.meta.artist} - ${c.meta.title} (bass chart).json`.replace(/[\\/:*?"<>|]/g, '_') });
    document.body.append(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  return [section, scoringSection];
}
