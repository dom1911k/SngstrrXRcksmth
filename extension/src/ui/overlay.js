// Highway overlay: a canvas docked above the player controls, with view
// modes Highway only / Both / Tab only (Songsterr) and a 3D (Rocksmith) or
// 2D renderer. Also used full-window by the standalone player page.
import { h } from './dom.js';
import { Highway2D } from './highway2d.js';
import { getSettings, updateSettings, onSettingsChange } from '../core/settings.js';
import { createScoreUI, SCORE_CSS } from './score-ui.js';
import { createProgressUI, PROGRESS_CSS } from './progress-ui.js';
import { createEndScreen, END_CSS } from './end-screen.js';
import { loopBars as loopBarsOf, loopCurrentSection, sectionAt } from '../core/riff-repeater.js';
import { tuningName } from '../core/music.js';

const CSS = (controlsGap) => `
:host { all: initial; }
* { box-sizing: border-box; }
.wrap { position: fixed; left: 0; right: 0; z-index: 2147482990; background: #06070c;
  border-top: 1px solid #2c2f36; border-bottom: 1px solid #2c2f36; font: 13px/1.4 system-ui, "Segoe UI", sans-serif; color: #e8e8ea; }
.wrap[hidden] { display: none; }
canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
canvas[hidden] { display: none; }
.bar { position: absolute; left: 8px; bottom: 8px; display: flex; gap: 4px; z-index: 2; }
.bar button, .pill { background: rgba(30,33,40,.85); color: #c9ced8; border: 1px solid #3a3f49; border-radius: 6px;
  padding: 3px 9px; font: 600 12px system-ui, sans-serif; cursor: pointer; }
.bar button.on { background: #f2c418; color: #111; border-color: #f2c418; }
.bar button.star[hidden] { display: none; }
.bar .sep { width: 8px; }
.grip { position: absolute; top: -5px; left: 0; right: 0; height: 10px; cursor: ns-resize; z-index: 3; }
.msg { position: absolute; left: 50%; top: 45%; transform: translate(-50%, -50%); text-align: center; z-index: 2;
  background: rgba(10,12,16,.9); border: 1px solid #3a3f49; border-radius: 10px; padding: 14px 18px; max-width: 80%; }
.msg[hidden] { display: none; }
.msg button { margin: 8px 4px 0; background: #e8202a; color: #fff; border: none; border-radius: 6px; padding: 6px 12px; font: 600 13px system-ui; cursor: pointer; }
.pill { position: fixed; left: 8px; bottom: ${controlsGap + 6}px; z-index: 2147482990; }
.pill[hidden] { display: none; }
.hud { position: absolute; top: 8px; left: 12px; right: 56px; display: flex; justify-content: space-between; pointer-events: none; z-index: 2;
  font: 600 17px system-ui, "Segoe UI", sans-serif; text-shadow: 0 1px 3px #000; }
.hud .left { color: #d4d9e3; }
.hud .right { color: #f2c418; }
.hud .center { position: absolute; left: 0; right: 0; top: 64px; text-align: center; color: #ffb347; }
.notice { position: absolute; left: 50%; bottom: 46px; transform: translateX(-50%); z-index: 4; background: rgba(16,18,24,.92);
  border: 1px solid #3a3f49; border-radius: 8px; padding: 6px 14px; font: 600 14px system-ui; color: #e8e8ea; transition: opacity .25s; pointer-events: none; }
.notice.hide { opacity: 0; }
.withbar .hud { top: 24px; }
.withbar .score { top: 22px; }
.withbar .hint { top: 24px; }
.hud .center.wait { left: 50%; right: auto; transform: translateX(-50%); top: 40px; white-space: nowrap; color: #fff; font-size: 18px;
  background: rgba(10,12,16,.88); border: 1px solid #f2c418; border-radius: 8px; padding: 5px 14px; }
.warnbox { position: absolute; left: 50%; top: 92px; transform: translateX(-50%); z-index: 4; max-width: min(640px, 90%);
  background: rgba(43,36,16,.95); border: 1px solid #6a5418; color: #f2c418; border-radius: 8px; padding: 7px 14px; font: 600 13px/1.4 system-ui; text-align: center; }
.warnbox[hidden] { display: none; }
.titlecard { position: absolute; left: 0; right: 0; top: 26%; z-index: 4; text-align: center; pointer-events: none; font-family: system-ui, "Segoe UI", sans-serif; }
.titlecard[hidden] { display: none; }
.titlecard .t { font-size: 46px; font-weight: 900; color: #fff; text-shadow: 0 0 24px rgba(120,160,255,.5), 0 2px 6px #000; }
.titlecard .a { font-size: 22px; font-weight: 600; color: #c9d2ea; margin-top: 4px; text-shadow: 0 2px 6px #000; }
.titlecard .m { font-size: 13px; letter-spacing: .25em; color: #8fa0c8; margin-top: 10px; text-transform: uppercase; }
.titlecard.go { animation: tc 4s ease-in-out forwards; }
@keyframes tc { 0% { opacity: 0; transform: translateY(14px); } 15% { opacity: 1; transform: none; } 75% { opacity: 1; } 100% { opacity: 0; } }
.pausescreen { position: absolute; inset: 0; z-index: 3; display: flex; align-items: center; justify-content: center; pointer-events: none;
  background: radial-gradient(ellipse at center, rgba(6,7,12,.35), rgba(6,7,12,.75)); }
.pausescreen[hidden] { display: none; }
.pausescreen .box { pointer-events: auto; text-align: center; font-family: system-ui, "Segoe UI", sans-serif; }
.pausescreen .p { font-size: 34px; font-weight: 900; letter-spacing: .3em; color: #fff; text-shadow: 0 2px 8px #000; }
.pausescreen .where { color: #aeb6c8; margin: 4px 0 14px; font-size: 14px; }
.pausescreen button { background: rgba(30,33,40,.92); color: #fff; border: 1px solid #3a3f49; border-radius: 8px; padding: 8px 14px; font: 600 14px system-ui; cursor: pointer; margin: 3px; }
.pausescreen button.primary { background: #e8202a; border-color: #e8202a; }
.pausescreen button.on { background: #f2c418; color: #111; border-color: #f2c418; }
.debug { position: absolute; right: 10px; bottom: 8px; color: #6f7685; font: 11px system-ui; pointer-events: none; z-index: 2; }
`;

export function createOverlay(adapter, {
  controlsGap = 92,      // keep Songsterr's bottom player controls visible
  headerGap = 56,
  modes = [['highway', 'Highway'], ['both', 'Both'], ['tab', 'Tab']],
  fixedMode = null,      // e.g. 'highway' on the standalone player page
  session = null,        // ScoringSession (optional)
  history = null,        // HistoryRecorder: section strip + progress card (optional)
  wait = null,           // WaitMode (optional)
  takes = null,          // Takes (optional)
  riff = null,           // RiffRepeater (optional)
  monitor = null,        // InputMonitor: warnings + held-note feedback (optional)
  library = null,        // LibraryTracker: ★ save button (optional)
  report = null,         // SessionReport: shown when the input stops (optional)
} = {}) {
  const host = h('div', { id: 'bass-trainer-highway' });
  const root = host.attachShadow({ mode: 'open' });
  root.append(h('style', {}, CSS(controlsGap) + SCORE_CSS + PROGRESS_CSS + END_CSS));

  const canvas2d = h('canvas');
  const canvas3d = h('canvas');
  const hudLeft = h('div', { class: 'left' });
  const hudRight = h('div', { class: 'right' });
  const hudCenter = h('div', { class: 'center' });
  const hud = h('div', { class: 'hud' }, hudLeft, hudRight, hudCenter);
  const debugEl = h('div', { class: 'debug' });
  const notice = h('div', { class: 'notice hide' });
  const warnBox = h('div', { class: 'warnbox', hidden: true });
  const titleCard = h('div', { class: 'titlecard', hidden: true });
  const pauseWhere = h('div', { class: 'where' });
  const riffBtn = h('button', { onclick: () => updateSettings({ riffRepeater: !getSettings().riffRepeater }) }, 'Riff repeater');
  const pauseScreen = h('div', { class: 'pausescreen', hidden: true },
    h('div', { class: 'box' }, h('div', { class: 'p' }, 'PAUSED'), pauseWhere,
      h('div', {},
        h('button', { class: 'primary', onclick: () => adapter.play() }, '▶ Resume'),
        h('button', { onclick: () => { const sec = sectionNow(); adapter.seek(sec ? sec.t : 0); adapter.play(); } }, '⏮ Section start'),
        h('button', { onclick: () => loopCurrentSection(adapter, (t) => notify(t)) }, '⟲ Loop this section'),
        riffBtn)));
  const highway2d = new Highway2D(canvas2d);
  let highway3d = null;
  let highway3dFailed = false;
  let active = highway2d;
  let lastChart = null;

  const modeButtons = {};
  const styleButtons = {};
  const bar = h('div', { class: 'bar' },
    ...(fixedMode ? [] : modes.map(([mode, label]) => {
      modeButtons[mode] = h('button', { onclick: () => updateSettings({ viewMode: mode }) }, label);
      return modeButtons[mode];
    })),
    fixedMode ? null : h('span', { class: 'sep' }),
    ...[['3d', '3D'], ['2d', '2D']].map(([style, label]) => {
      styleButtons[style] = h('button', { title: style === '3d' ? 'Rocksmith-style 3D highway' : 'Simple 2D highway', onclick: () => updateSettings({ highwayStyle: style }) }, label);
      return styleButtons[style];
    }),
  );
  // ★ Save the song in the library (favourite).
  const star = h('button', { class: 'star', title: 'Save this song in your library (favourites)', hidden: true, onclick: async () => {
    const e = await library.toggleFavorite();
    if (e) notify(e.favorite ? 'Saved in your library ★' : 'Removed from favourites');
  } }, '☆ Save');
  if (library) {
    bar.append(h('span', { class: 'sep' }), star);
    library.onChange((e) => {
      star.hidden = !e;
      const fav = !!(e && e.favorite);
      star.textContent = fav ? '★ Saved' : '☆ Save';
      star.classList.toggle('on', fav);
    });
  }
  const grip = h('div', { class: 'grip', title: 'Drag to resize' });
  const msg = h('div', { class: 'msg', hidden: true });
  const wrap = h('div', { class: 'wrap' }, canvas2d, canvas3d, hud, grip, msg, bar, debugEl, notice, warnBox, titleCard, pauseScreen);
  const pill = h('button', { class: 'pill', hidden: true, onclick: () => updateSettings({ viewMode: 'both' }) }, '▲ Highway');
  root.append(wrap, pill);
  // Rocksmith-style end-of-song screen and session report.
  const endScreen = createEndScreen(wrap, {
    adapter, history,
    onDetails: (s) => scoreUI && scoreUI.showCard(s),
    loopBars: (a, b) => loopBarsOf(adapter, a, b, (t) => notify(t)),
  });
  const scoreUI = session ? createScoreUI(wrap, session, () => active, { onSongEnd: (s) => endScreen.showSong(s) }) : null;
  const openLibrary = typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage
    ? () => chrome.runtime.sendMessage({ type: 'openLibrary' }) : null;
  if (report) report.onReport((r) => { if (!fixedMode && getSettings().viewMode === 'tab') updateSettings({ viewMode: 'both' }); endScreen.showSession(r, { onLibrary: openLibrary }); });
  const progressUI = history ? createProgressUI(wrap, { adapter, history, riff, notify: (t) => notify(t) }) : null;

  // Resize by dragging the top edge (Both mode).
  grip.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    grip.setPointerCapture(e.pointerId);
    const move = (ev) => {
      const frac = (window.innerHeight - controlsGap - ev.clientY) / window.innerHeight;
      updateSettings({ highwayHeight: Math.max(0.2, Math.min(0.85, frac)) });
    };
    const up = () => { grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', up); };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
  });

  async function ensure3d() {
    if (highway3d || highway3dFailed) return highway3d;
    try {
      const { Highway3D } = await import('./highway3d.js');
      if (!Highway3D.isSupported()) throw new Error('WebGL not available');
      highway3d = new Highway3D(canvas3d);
      highway3d.setChart(lastChart);
      layout();
    } catch (err) {
      console.warn('[Bass Trainer] 3D highway unavailable, using 2D', err);
      highway3dFailed = true;
      layout();
    }
    return highway3d;
  }

  function layout(s = getSettings()) {
    const mode = fixedMode || s.viewMode;
    for (const [m, btn] of Object.entries(modeButtons)) btn.classList.toggle('on', mode === m);
    const want3d = s.highwayStyle === '3d' && !highway3dFailed;
    if (want3d && !highway3d) ensure3d();
    active = want3d && highway3d ? highway3d : highway2d;
    for (const [st, btn] of Object.entries(styleButtons)) btn.classList.toggle('on', (active === highway3d ? '3d' : '2d') === st);
    styleButtons['3d'].disabled = highway3dFailed;
    canvas3d.hidden = active !== highway3d;
    canvas2d.hidden = active !== highway2d;
    hud.hidden = active !== highway3d; // the 2D renderer draws its own HUD
    wrap.hidden = mode === 'tab';
    pill.hidden = mode !== 'tab';
    grip.hidden = mode !== 'both';
    wrap.style.bottom = `${controlsGap}px`;
    if (mode === 'highway') {
      wrap.style.top = `${headerGap}px`;
      wrap.style.height = '';
    } else {
      wrap.style.top = '';
      wrap.style.height = `${Math.round(s.highwayHeight * window.innerHeight)}px`;
    }
    const opts = { lookahead: s.lookahead, invertStrings: s.invertStrings, showDebug: s.showDebug };
    highway2d.setOptions(opts);
    if (highway3d) highway3d.setOptions({ ...opts, showFretNumbers: s.gemFretNumbers, sparks: s.hitSparks, timingMarks: s.timingMarks, glow: s.glowEffects, theme: s.theme, largeNotes: s.largeNotes });
  }
  onSettingsChange(layout);
  window.addEventListener('resize', () => layout());
  layout();

  function showMessage(text, buttons = []) {
    if (!text) { msg.hidden = true; return; }
    msg.replaceChildren(h('div', {}, text), ...buttons.map(([label, fn]) => h('button', { onclick: fn }, label)));
    msg.hidden = false;
  }

  function setChart(chart) {
    lastChart = chart;
    highway2d.setChart(chart);
    if (highway3d) highway3d.setChart(chart);
  }

  adapter.on('chart', (info) => {
    if (info.error && !info.chart) {
      setChart(null);
      showMessage(info.error.startsWith('Tab not loaded') ? '' : `Could not read this tab: ${info.error}`);
      return;
    }
    if (!info.isBassLike) {
      setChart(null);
      if (info.bassTracks && info.bassTracks.length) {
        showMessage(`"${info.track ? info.track.instrument : 'This track'}" is not a bass part. Switch to:`,
          info.bassTracks.map((t) => [t.instrument + (t.name ? ` (${t.name.split('|').pop().trim()})` : ''), () => adapter.switchTrack(t.partId)]));
      } else {
        showMessage('This song has no bass track on Songsterr.');
      }
      return;
    }
    showMessage('');
    setChart(info.chart);
  });

  // Diagnostics on the host element (readable from DevTools and tests).
  setInterval(() => {
    host.dataset.time = adapter.getTime().toFixed(3);
    host.dataset.perf = performance.now().toFixed(1);
    host.dataset.syncErrMs = (adapter.clock.lastError * 1000).toFixed(2);
    host.dataset.snaps = adapter.clock.snaps;
    host.dataset.fps = Math.round(active.fps);
    host.dataset.notes = lastChart ? lastChart.notes.length : 0;
    host.dataset.status = adapter.status.state;
    host.dataset.renderer = active === highway3d ? '3d' : '2d';
  }, 250);

  function barAt(t) {
    const bars = lastChart ? lastChart.bars : [];
    let lo = 0, hi = bars.length - 1, best = null;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (bars[mid].t <= t) { best = bars[mid]; lo = mid + 1; } else hi = mid - 1; }
    return best;
  }

  function frame() {
    requestAnimationFrame(frame);
    if (wrap.hidden) return;
    const s = getSettings();
    const st = adapter.getState();
    const speed = st.ready ? st.speed : 1;
    if (scoreUI) scoreUI.update(!!lastChart);
    // What you hear lags the player position by the output delay.
    const time = adapter.getTime() - (s.visualDelayMs / 1000) * speed;
    let message = '';
    if (adapter.status.state !== 'ok') message = adapter.status.detail;
    else if (st.countIn) message = 'Count-in…';
    const playing = st.ready && st.shouldPlay;
    const loop = st.ready ? st.loop : null;
    if (progressUI) {
      progressUI.update(time, loop);
      wrap.classList.toggle('withbar', progressUI.visible);
    }
    const waitMsg = wait && wait.enabled ? wait.message : '';
    updatePause(st);
    if (monitor) {
      const w = st.ready && st.shouldPlay && !(wait && wait.enabled) ? monitor.warning : '';
      if (warnBox.textContent !== w) warnBox.textContent = w;
      warnBox.hidden = !w;
    }
    active.render({ time, speed, playing, loop, message: active === highway2d ? message || waitMsg : message,
      heard: monitor && playing ? monitor.heardMidi() : null,
      topInset: progressUI && progressUI.visible ? 18 : 0,
      debug: `sync err ${(adapter.clock.lastError * 1000).toFixed(1)} ms · snaps ${adapter.clock.snaps} · t ${time.toFixed(2)}s · ${st.playerType || ''}` });
    if (active === highway3d) {
      const bar = barAt(time);
      hudLeft.textContent = bar ? `${bar.section ? bar.section + ' · ' : ''}bar ${bar.measure + 1}` : '';
      const right = [];
      if (takes && takes.armed) right.push('● REC');
      if (takes && takes.playback) right.push('▶ TAKE');
      if (wait && wait.enabled) right.push('WAIT');
      if (riff && riff.enabled && loop) right.push('RIFF');
      if (Math.abs(speed - 1) > 0.001) right.push(`${Math.round(speed * 100)}%`);
      if (loop) right.push('LOOP');
      if (!playing) right.push('PAUSED');
      hudRight.textContent = right.join('   ');
      const waiting = !message && wait && wait.enabled && wait.message;
      hudCenter.classList.toggle('wait', !!waiting);
      hudCenter.textContent = message || (waiting ? wait.message : '') || (!lastChart && msg.hidden ? 'Waiting for the song…' : '');
      debugEl.textContent = s.showDebug ? `sync err ${(adapter.clock.lastError * 1000).toFixed(1)} ms · ${Math.round(active.fps)} fps` : '';
    } else {
      debugEl.textContent = '';
    }
  }
  requestAnimationFrame(frame);

  // Title card when a song starts from the beginning (as in Rocksmith).
  function sectionNow() { return lastChart ? sectionAt(lastChart, adapter.getTime()) : null; }
  let titleTimer = null;
  adapter.on('play', () => {
    if (!lastChart || wrap.hidden || !lastChart.notes.length) return;
    if (adapter.getTime() > lastChart.notes[0].t - 0.5) return;
    const m = lastChart.meta || {};
    titleCard.replaceChildren(h('div', { class: 't' }, m.title || ''), m.artist ? h('div', { class: 'a' }, m.artist) : null,
      h('div', { class: 'm' }, [m.track && !/drill/i.test(m.track) ? 'Bass' : m.track, tuningName(lastChart.instrument.tuning)].filter(Boolean).join(' · ')));
    titleCard.hidden = false;
    titleCard.classList.remove('go');
    void titleCard.offsetWidth;
    titleCard.classList.add('go');
    clearTimeout(titleTimer);
    titleTimer = setTimeout(() => { titleCard.hidden = true; }, 4000);
  });
  for (const ev of ['pause', 'seek', 'chart']) adapter.on(ev, () => { titleCard.hidden = true; clearTimeout(titleTimer); });
  // Pause screen in the full highway view.
  function updatePause(st) {
    const full = fixedMode || getSettings().viewMode === 'highway';
    const busy = endScreen.visible || [...root.querySelectorAll('.card')].some((c) => !c.hidden) || (wait && wait.enabled) || (takes && takes.playback);
    const show = !!(full && lastChart && st.ready && !st.shouldPlay && !st.countIn && adapter.getTime() > 0.3 && !busy && msg.hidden);
    if (show) {
      const sec = sectionNow();
      const b = barAt(adapter.getTime());
      const text = `${sec ? sec.name : ''}${b ? ` · bar ${b.measure + 1}` : ''}`;
      if (pauseWhere.textContent !== text) pauseWhere.textContent = text;
      riffBtn.classList.toggle('on', !!getSettings().riffRepeater);
    }
    if (pauseScreen.hidden === show) pauseScreen.hidden = !show;
  }

  // Sparks / timing dots for scored notes (3D only).
  if (session) {
    session.on('result', (r) => {
      if (active === highway3d && highway3d) {
        const st = adapter.getState();
        highway3d.onResult(r, { speed: st.ready ? st.speed : 1 });
      }
    });
  }

  // Short confirmation (e.g. from a shortcut), shown on the highway.
  let noticeTimer = null;
  function notify(text) {
    notice.textContent = text;
    notice.classList.remove('hide');
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => notice.classList.add('hide'), 1600);
  }

  function toggleView() {
    if (fixedMode) return;
    const order = modes.map(([m]) => m);
    const next = order[(order.indexOf(getSettings().viewMode) + 1) % order.length];
    updateSettings({ viewMode: next });
    notify(`View: ${modes.find(([m]) => m === next)[1]}`);
  }

  // Escape: close an open card first; otherwise leave the full highway view
  // (Highway -> Both).
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || e.repeat || wrap.hidden) return;
    const t = e.composedPath ? e.composedPath()[0] : e.target;
    if (t && t.tagName && /^(input|textarea|select)$/i.test(t.tagName)) return;
    const open = [...root.querySelectorAll('.card')].filter((c) => !c.hidden);
    if (endScreen.visible) {
      endScreen.hide();
    } else if (open.length) {
      open.forEach((c) => { c.hidden = true; });
    } else if (!fixedMode && getSettings().viewMode === 'highway') {
      updateSettings({ viewMode: 'both' });
      notify('View: Both');
    } else return;
    e.preventDefault();
    e.stopImmediatePropagation();
  }, true);

  return { host, scoreUI, progressUI, endScreen, notify, toggleView, showProgress: () => progressUI && progressUI.show(), get highway() { return active; } };
}
