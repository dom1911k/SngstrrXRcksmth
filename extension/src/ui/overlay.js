// Highway overlay: a canvas docked above the player controls, with view
// modes Highway only / Both / Tab only (Songsterr) and a 3D (Rocksmith) or
// 2D renderer. Also used full-window by the standalone player page.
import { h } from './dom.js';
import { Highway2D } from './highway2d.js';
import { getSettings, updateSettings, onSettingsChange } from '../core/settings.js';

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
.hud .center { position: absolute; left: 0; right: 0; top: 30px; text-align: center; color: #ffb347; }
.debug { position: absolute; right: 10px; bottom: 8px; color: #6f7685; font: 11px system-ui; pointer-events: none; z-index: 2; }
`;

export function createOverlay(adapter, {
  controlsGap = 92,      // keep Songsterr's bottom player controls visible
  headerGap = 56,
  modes = [['highway', 'Highway'], ['both', 'Both'], ['tab', 'Tab']],
  fixedMode = null,      // e.g. 'highway' on the standalone player page
} = {}) {
  const host = h('div', { id: 'bass-trainer-highway' });
  const root = host.attachShadow({ mode: 'open' });
  root.append(h('style', {}, CSS(controlsGap)));

  const canvas2d = h('canvas');
  const canvas3d = h('canvas');
  const hudLeft = h('div', { class: 'left' });
  const hudRight = h('div', { class: 'right' });
  const hudCenter = h('div', { class: 'center' });
  const hud = h('div', { class: 'hud' }, hudLeft, hudRight, hudCenter);
  const debugEl = h('div', { class: 'debug' });
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
  const grip = h('div', { class: 'grip', title: 'Drag to resize' });
  const msg = h('div', { class: 'msg', hidden: true });
  const wrap = h('div', { class: 'wrap' }, canvas2d, canvas3d, hud, grip, msg, bar, debugEl);
  const pill = h('button', { class: 'pill', hidden: true, onclick: () => updateSettings({ viewMode: 'both' }) }, '▲ Highway');
  root.append(wrap, pill);

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
    if (highway3d) highway3d.setOptions({ ...opts, showFretNumbers: s.gemFretNumbers });
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
    // What you hear lags the player position by the output delay.
    const time = adapter.getTime() - (s.visualDelayMs / 1000) * speed;
    let message = '';
    if (adapter.status.state !== 'ok') message = adapter.status.detail;
    else if (st.countIn) message = 'Count-in…';
    const playing = st.ready && st.shouldPlay;
    const loop = st.ready ? st.loop : null;
    active.render({ time, speed, playing, loop, message,
      debug: `sync err ${(adapter.clock.lastError * 1000).toFixed(1)} ms · snaps ${adapter.clock.snaps} · t ${time.toFixed(2)}s · ${st.playerType || ''}` });
    if (active === highway3d) {
      const bar = barAt(time);
      hudLeft.textContent = bar ? `${bar.section ? bar.section + ' · ' : ''}bar ${bar.measure + 1}` : '';
      const right = [];
      if (Math.abs(speed - 1) > 0.001) right.push(`${Math.round(speed * 100)}%`);
      if (loop) right.push('LOOP');
      if (!playing) right.push('PAUSED');
      hudRight.textContent = right.join('   ');
      hudCenter.textContent = message || (!lastChart && msg.hidden ? 'Waiting for the song…' : '');
      debugEl.textContent = s.showDebug ? `sync err ${(adapter.clock.lastError * 1000).toFixed(1)} ms · ${Math.round(active.fps)} fps` : '';
    } else {
      debugEl.textContent = '';
    }
  }
  requestAnimationFrame(frame);

  return { host, get highway() { return active; } };
}
