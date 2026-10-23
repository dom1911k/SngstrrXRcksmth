import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSettings, updateSettings } from '../extension/src/core/settings.js';
import { barAt, nextSpeed, createShortcutActions, bindingLabel, bindingFromEvent, getShortcuts, setShortcut, resetShortcuts } from '../extension/src/core/shortcuts.js';

const bars = [0, 2, 4, 6, 8].map((t, i) => ({ i, t, end: t + 2, measure: i }));
function fakeAdapter() {
  const st = { ready: true, shouldPlay: false, speed: 1, loop: null };
  const calls = [];
  return {
    calls, st, time: 0,
    getChart: () => ({ bars }),
    getTime() { return this.time; },
    getState: () => st,
    play: () => { calls.push('play'); st.shouldPlay = true; },
    pause: () => { calls.push('pause'); st.shouldPlay = false; },
    seek: (t) => calls.push(['seek', t]),
    setLoop: (a, b) => { calls.push(['loop', a, b]); st.loop = { start: a, end: b }; },
    clearLoop: () => { calls.push('clear'); st.loop = null; },
    setSpeed: (v) => { calls.push(['speed', v]); st.speed = v / 100; },
  };
}

test('speed steps of 5%, clamped', () => {
  assert.equal(nextSpeed(1, -1), 95);
  assert.equal(nextSpeed(0.93, 1), 95);
  assert.equal(nextSpeed(0.93, -1), 90);
  assert.equal(nextSpeed(0.25, -1), 25);
  assert.equal(nextSpeed(1.5, 1), 150);
});

test('loop start/end by bar, notices, clear, restart to loop start', () => {
  const a = fakeAdapter();
  const notes = [];
  const act = createShortcutActions(a, { notify: (t) => notes.push(t) });
  a.time = 2.5; act.loopStart();
  a.time = 5.9; act.loopEnd();
  assert.deepEqual(a.calls.at(-1), ['loop', 2, 6]);
  assert.equal(notes.at(-1), 'Loop: bars 2–3');
  act.restart();
  assert.deepEqual(a.calls.slice(-2), [['seek', 2], 'play']);
  act.loopClear();
  assert.equal(a.st.loop, null);
  a.time = 4.2; act.loopEnd(); // no start set: loop this one bar
  assert.deepEqual(a.calls.at(-1), ['loop', 4, 6]);
  assert.equal(barAt(bars, 7.99).measure, 3);
});

test('play/pause toggles; speed keys change speed', () => {
  const a = fakeAdapter();
  const act = createShortcutActions(a);
  act.playPause(); act.playPause();
  assert.deepEqual(a.calls, ['play', 'pause']);
  act.speedDown(); act.speedDown(); act.speedUp();
  assert.deepEqual(a.calls.slice(-3), [['speed', 95], ['speed', 90], ['speed', 95]]);
});

test('bindings: labels, modifiers, a key moves from one action to another', async () => {
  await loadSettings();
  await resetShortcuts();
  assert.equal(bindingLabel('Shift+PageDown'), 'Shift+Page Down');
  assert.equal(bindingLabel('KeyA'), 'A');
  assert.equal(bindingFromEvent({ code: 'PageDown', shiftKey: true }), 'Shift+PageDown');
  await setShortcut('playPause', ['PageDown']);
  await setShortcut('restart', ['PageDown', 'Home']);
  const map = getShortcuts();
  assert.deepEqual(map.playPause, []);
  assert.deepEqual(map.restart, ['PageDown', 'Home']);
  await resetShortcuts();
  assert.deepEqual(getShortcuts().playPause, ['Space']);
  await updateSettings({});
});
