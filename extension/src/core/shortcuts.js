// Keyboard / foot-pedal shortcuts. A foot pedal that "types" a key works the
// same as the keyboard. Bindings are KeyboardEvent.code values with optional
// modifiers, e.g. 'Space', 'KeyA', 'Shift+PageDown', so they don't depend on
// the keyboard layout. Each action can have several bindings.

import { getSettings, updateSettings } from './settings.js';

export const ACTIONS = [
  ['playPause', 'Play / pause'],
  ['restart', 'Restart (song or loop start)'],
  ['loopStart', 'Loop start at this bar'],
  ['loopEnd', 'Loop end at this bar'],
  ['loopClear', 'Clear loop'],
  ['speedDown', 'Slower (−5%)'],
  ['speedUp', 'Faster (+5%)'],
  ['toggleView', 'Highway / Both / Tab'],
  ['loopSection', 'Loop the current section'],
  ['riffRepeater', 'Riff repeater on / off'],
  ['waitMode', 'Wait mode on / off'],
  ['recordTakes', 'Record takes on / off'],
];

export const DEFAULT_SHORTCUTS = {
  playPause: ['Space'],
  restart: ['Home', 'KeyR'],
  loopStart: ['KeyA'],
  loopEnd: ['KeyB'],
  loopClear: ['KeyC'],
  speedDown: ['NumpadSubtract', 'Minus'],
  speedUp: ['NumpadAdd', 'Equal'],
  toggleView: ['KeyV'],
  loopSection: ['KeyL'],
  riffRepeater: [],
  waitMode: ['KeyW'],
  recordTakes: [],
};

export function bindingFromEvent(e) {
  const mods = [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Meta'].filter(Boolean);
  return [...mods, e.code].join('+');
}

const NAMES = { Space: 'Space', Minus: '-', Equal: '=', NumpadSubtract: 'Num −', NumpadAdd: 'Num +', BracketLeft: '[', BracketRight: ']', Backslash: '\\', ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', PageUp: 'Page Up', PageDown: 'Page Down' };

// Human-readable name of a binding ("Shift+A", "Page Down").
export function bindingLabel(b) {
  return b.split('+').map((part) => NAMES[part] || part.replace(/^Key/, '').replace(/^Digit/, '').replace(/^Numpad/, 'Num ')).join('+');
}

export function getShortcuts() {
  const s = getSettings().shortcuts || {};
  const out = {};
  for (const [action] of ACTIONS) out[action] = s[action] || DEFAULT_SHORTCUTS[action];
  return out;
}

export function setShortcut(action, bindings) {
  const s = { ...(getSettings().shortcuts || {}) };
  s[action] = bindings;
  // A key can only do one thing: remove it from other actions.
  for (const [other] of ACTIONS) {
    if (other === action) continue;
    const list = s[other] || DEFAULT_SHORTCUTS[other];
    const filtered = list.filter((b) => !bindings.includes(b));
    if (filtered.length !== list.length) s[other] = filtered;
  }
  return updateSettings({ shortcuts: s });
}

export function resetShortcuts() {
  return updateSettings({ shortcuts: {} });
}

function isTyping(e) {
  const t = e.composedPath ? e.composedPath()[0] : e.target;
  if (!t || !t.tagName) return false;
  const tag = t.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || t.isContentEditable;
}

// Pure helpers for loops by bar (exported for tests).
export function barAt(bars, t) {
  let best = bars[0] || null;
  for (const b of bars) { if (b.t <= t + 1e-6) best = b; else break; }
  return best;
}

export function nextSpeed(current, dir) {
  const pct = Math.round(current * 100);
  const stepped = dir < 0 ? Math.floor((pct - 1) / 5) * 5 : Math.ceil((pct + 1) / 5) * 5;
  return Math.max(25, Math.min(150, stepped));
}

// Runs the actions on a player adapter. notify(text) shows a short message.
export function createShortcutActions(adapter, { notify = () => {}, onToggleView = () => {}, extra = {} } = {}) {
  let pendingStart = null;
  const chart = () => adapter.getChart();
  const label = (bar) => bar.measure + 1;

  return {
    playPause() {
      const st = adapter.getState();
      if (st.shouldPlay) adapter.pause(); else adapter.play();
    },
    restart() {
      const st = adapter.getState();
      adapter.seek(st.loop ? st.loop.start : 0);
      if (!st.shouldPlay) adapter.play();
      notify(st.loop ? 'Back to loop start' : 'Back to the start');
    },
    loopStart() {
      const c = chart();
      if (!c || !c.bars.length) return;
      const bar = barAt(c.bars, adapter.getTime());
      const st = adapter.getState();
      pendingStart = bar;
      if (st.loop && st.loop.end > bar.t) {
        adapter.setLoop(bar.t, st.loop.end);
        notify(`Loop: from bar ${label(bar)}`);
      } else {
        notify(`Loop start: bar ${label(bar)}. Press "loop end" at the last bar.`);
      }
    },
    loopEnd() {
      const c = chart();
      if (!c || !c.bars.length) return;
      const bar = barAt(c.bars, adapter.getTime());
      const st = adapter.getState();
      const start = pendingStart || (st.loop ? barAt(c.bars, st.loop.start) : bar);
      if (start.t > bar.t) { notify('The loop end must come after the loop start'); return; }
      adapter.setLoop(start.t, bar.end);
      pendingStart = null;
      notify(start === bar ? `Loop: bar ${label(bar)}` : `Loop: bars ${label(start)}–${label(bar)}`);
    },
    loopClear() {
      pendingStart = null;
      adapter.clearLoop();
      notify('Loop cleared');
    },
    speedDown() { const v = nextSpeed(adapter.getState().speed || 1, -1); adapter.setSpeed(v); notify(`Speed ${v}%`); },
    speedUp() { const v = nextSpeed(adapter.getState().speed || 1, 1); adapter.setSpeed(v); notify(`Speed ${v}%`); },
    toggleView() { onToggleView(); },
    ...extra,
  };
}

// Listens on the window (capture phase, before the page's own shortcuts).
// If a key is bound, our action runs and the page doesn't see the key.
export function installShortcuts(actions, { enabled = () => true } = {}) {
  const handler = (e) => {
    if (e.repeat || !enabled() || isTyping(e)) return;
    if (installShortcuts.recording) return; // the settings UI is capturing a key
    const b = bindingFromEvent(e);
    const map = getShortcuts();
    for (const [action, list] of Object.entries(map)) {
      if (list.includes(b) && actions[action]) {
        e.preventDefault();
        e.stopImmediatePropagation();
        actions[action]();
        return;
      }
    }
  };
  window.addEventListener('keydown', handler, true);
  return () => window.removeEventListener('keydown', handler, true);
}
installShortcuts.recording = false;
