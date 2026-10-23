// Highway overlay on the Songsterr page: a canvas docked above Songsterr's
// player controls, with view modes Highway only / Both / Tab only.
import { h } from './dom.js';
import { Highway2D } from './highway2d.js';
import { getSettings, updateSettings, onSettingsChange } from '../core/settings.js';

const CONTROLS_GAP = 92;  // keep Songsterr's bottom player controls visible
const HEADER_GAP = 56;

const CSS = `
:host { all: initial; }
* { box-sizing: border-box; }
.wrap { position: fixed; left: 0; right: 0; z-index: 2147482990; background: #05060a;
  border-top: 1px solid #2c2f36; border-bottom: 1px solid #2c2f36; font: 13px/1.4 system-ui, "Segoe UI", sans-serif; color: #e8e8ea; }
.wrap[hidden] { display: none; }
canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
.bar { position: absolute; left: 8px; bottom: 8px; display: flex; gap: 4px; z-index: 2; }
.bar button, .pill { background: rgba(30,33,40,.85); color: #c9ced8; border: 1px solid #3a3f49; border-radius: 6px;
  padding: 3px 9px; font: 600 12px system-ui, sans-serif; cursor: pointer; }
.bar button.on { background: #f2c418; color: #111; border-color: #f2c418; }
.grip { position: absolute; top: -5px; left: 0; right: 0; height: 10px; cursor: ns-resize; z-index: 3; }
.msg { position: absolute; left: 50%; top: 45%; transform: translate(-50%, -50%); text-align: center; z-index: 2;
  background: rgba(10,12,16,.9); border: 1px solid #3a3f49; border-radius: 10px; padding: 14px 18px; max-width: 80%; }
.msg[hidden] { display: none; }
.msg button { margin: 8px 4px 0; background: #e8202a; color: #fff; border: none; border-radius: 6px; padding: 6px 12px; font: 600 13px system-ui; cursor: pointer; }
.pill { position: fixed; left: 8px; bottom: ${CONTROLS_GAP + 6}px; z-index: 2147482990; }
.pill[hidden] { display: none; }
`;

export function createOverlay(adapter) {
  const host = h('div', { id: 'bass-trainer-highway' });
  const root = host.attachShadow({ mode: 'open' });
  root.append(h('style', {}, CSS));

  const canvas = h('canvas');
  const highway = new Highway2D(canvas);
  const modeButtons = {};
  const bar = h('div', { class: 'bar' },
    ...[['highway', 'Highway'], ['both', 'Both'], ['tab', 'Tab']].map(([mode, label]) => {
      modeButtons[mode] = h('button', { onclick: () => updateSettings({ viewMode: mode }) }, label);
      return modeButtons[mode];
    }));
  const grip = h('div', { class: 'grip', title: 'Drag to resize' });
  const msg = h('div', { class: 'msg', hidden: true });
  const wrap = h('div', { class: 'wrap' }, canvas, grip, msg, bar);
  const pill = h('button', { class: 'pill', hidden: true, onclick: () => updateSettings({ viewMode: 'both' }) }, '▲ Highway');
  root.append(wrap, pill);

  // Resize by dragging the top edge (Both mode).
  grip.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    grip.setPointerCapture(e.pointerId);
    const move = (ev) => {
      const frac = (window.innerHeight - CONTROLS_GAP - ev.clientY) / window.innerHeight;
      updateSettings({ highwayHeight: Math.max(0.2, Math.min(0.85, frac)) });
    };
    const up = () => { grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', up); };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
  });

  function layout(s = getSettings()) {
    for (const [mode, btn] of Object.entries(modeButtons)) btn.classList.toggle('on', s.viewMode === mode);
    wrap.hidden = s.viewMode === 'tab';
    pill.hidden = s.viewMode !== 'tab';
    grip.hidden = s.viewMode !== 'both';
    wrap.style.bottom = `${CONTROLS_GAP}px`;
    if (s.viewMode === 'highway') {
      wrap.style.top = `${HEADER_GAP}px`;
      wrap.style.height = '';
    } else {
      wrap.style.top = '';
      wrap.style.height = `${Math.round(s.highwayHeight * window.innerHeight)}px`;
    }
    highway.setOptions({ lookahead: s.lookahead, invertStrings: s.invertStrings, showDebug: s.showDebug });
  }
  onSettingsChange(layout);
  window.addEventListener('resize', () => layout());
  layout();

  // Message box for "not a bass track" etc.
  function showMessage(text, buttons = []) {
    if (!text) { msg.hidden = true; return; }
    msg.replaceChildren(h('div', {}, text), ...buttons.map(([label, fn]) => h('button', { onclick: fn }, label)));
    msg.hidden = false;
  }

  function onChart(info) {
    if (info.error && !info.chart) {
      highway.setChart(null);
      showMessage(info.error.startsWith('Tab not loaded') ? '' : `Could not read this tab: ${info.error}`);
      return;
    }
    if (!info.isBassLike) {
      highway.setChart(null);
      if (info.bassTracks.length) {
        showMessage(`"${info.track ? info.track.instrument : 'This track'}" is not a bass part. Switch to:`,
          info.bassTracks.map((t) => [t.instrument + (t.name ? ` (${t.name.split('|').pop().trim()})` : ''), () => adapter.switchTrack(t.partId)]));
      } else {
        showMessage('This song has no bass track on Songsterr.');
      }
      return;
    }
    showMessage('');
    highway.setChart(info.chart);
  }
  adapter.on('chart', onChart);

  // Diagnostics on the host element (readable from DevTools and tests).
  setInterval(() => {
    host.dataset.time = adapter.getTime().toFixed(3);
    host.dataset.perf = performance.now().toFixed(1);
    host.dataset.syncErrMs = (adapter.clock.lastError * 1000).toFixed(2);
    host.dataset.snaps = adapter.clock.snaps;
    host.dataset.fps = Math.round(highway.fps);
    host.dataset.notes = highway.chart ? highway.chart.notes.length : 0;
    host.dataset.status = adapter.status.state;
  }, 250);

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
    highway.render({
      time,
      speed,
      playing: st.ready && st.shouldPlay,
      loop: st.ready ? st.loop : null,
      message,
      debug: `sync err ${(adapter.clock.lastError * 1000).toFixed(1)} ms · snaps ${adapter.clock.snaps} · t ${time.toFixed(2)}s · ${st.playerType || ''}`,
    });
  }
  requestAnimationFrame(frame);

  return { host, highway };
}
