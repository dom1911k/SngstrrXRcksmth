// Panel section "Practice": bass muting, count-in and keyboard / foot-pedal shortcuts.
import { h } from './dom.js';
import { getSettings, updateSettings, onSettingsChange } from '../core/settings.js';
import { ACTIONS, getShortcuts, setShortcut, resetShortcuts, bindingFromEvent, bindingLabel, installShortcuts } from '../core/shortcuts.js';

export function createPracticeSection(adapter, autoMute) {
  const s = getSettings();
  const muteStatus = h('div', { class: 'muted' });
  const muteBox = h('input', { type: 'checkbox', checked: s.autoMuteBass, onchange: (e) => updateSettings({ autoMuteBass: e.target.checked }) });
  const ciBefore = h('input', { type: 'checkbox', checked: s.countIn, onchange: () => applyCountIn() });
  const ciLoops = h('input', { type: 'checkbox', checked: s.countInLoops, onchange: () => applyCountIn() });
  const list = h('div', { class: 'shortcuts' });

  function applyCountIn() {
    updateSettings({ countIn: ciBefore.checked, countInLoops: ciLoops.checked });
    adapter.setCountIn({ before: ciBefore.checked, loops: ciLoops.checked });
  }

  function renderShortcuts() {
    const map = getShortcuts();
    list.replaceChildren(...ACTIONS.map(([action, label]) => {
      const keys = map[action];
      return h('div', { class: 'row sc' },
        h('span', { class: 'grow' }, label),
        h('span', { class: 'keys' }, keys.length ? keys.map((k) => h('kbd', {}, bindingLabel(k))) : h('span', { class: 'muted' }, 'none')),
        h('button', { class: 'btn small', title: 'Press a key or foot pedal to use for this', onclick: (e) => record(action, e.target, false) }, 'Set'),
        h('button', { class: 'btn small', title: 'Add another key', onclick: (e) => record(action, e.target, true) }, '+'));
    }));
  }

  function record(action, btn, add) {
    btn.textContent = 'Press a key…';
    installShortcuts.recording = true;
    const onKey = (e) => {
      if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      window.removeEventListener('keydown', onKey, true);
      installShortcuts.recording = false;
      if (e.code === 'Escape') { renderShortcuts(); return; }
      const b = bindingFromEvent(e);
      const current = getShortcuts()[action];
      setShortcut(action, add ? [...new Set([...current, b])] : [b]).then(renderShortcuts);
    };
    window.addEventListener('keydown', onKey, true);
  }

  const section = h('section', {},
    h('h2', {}, 'Practice'),
    h('label', { class: 'row muted' }, muteBox, 'Mute the song\'s bass track while the input is on (restored when you stop)'),
    muteStatus,
    h('label', { class: 'row muted' }, ciBefore, 'Count-in before playback'),
    h('label', { class: 'row muted' }, ciLoops, 'Count-in before each loop restart'),
  );

  const shortcutsSection = h('section', {},
    h('h2', {}, 'Shortcuts (keyboard or foot pedal)'),
    h('div', { class: 'muted' }, 'Click "Set" and press the key (or step on the pedal). Escape cancels. They work while the page has focus.'),
    list,
    h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => resetShortcuts().then(renderShortcuts) }, 'Reset to defaults')),
  );

  setInterval(() => { muteStatus.textContent = getSettings().autoMuteBass ? autoMute.status : ''; }, 500);
  onSettingsChange(() => { muteBox.checked = getSettings().autoMuteBass; });
  renderShortcuts();
  return [section, shortcutsSection];
}
