// Panel sections for V2 practice tools: riff repeater, wait mode, takes and
// progress (practice history).
import { h } from './dom.js';
import { getSettings, updateSettings, onSettingsChange } from '../core/settings.js';
import { loopCurrentSection } from '../core/riff-repeater.js';

export function createTrainingSections({ adapter, riff, wait, takes, notify = () => {}, showProgress = null }) {
  const s = getSettings();

  // ---------- Riff repeater ----------
  const rrBox = h('input', { type: 'checkbox', checked: s.riffRepeater, onchange: (e) => updateSettings({ riffRepeater: e.target.checked }) });
  const num = (key, min, max, step, suffix) => h('span', { class: 'row', style: { margin: 0, gap: '4px', flexWrap: 'nowrap' } },
    h('input', { type: 'number', min, max, step, value: s[key], style: { width: '58px' }, onchange: (e) => {
      const v = Math.max(min, Math.min(max, Math.round(Number(e.target.value) || s[key])));
      e.target.value = v;
      updateSettings({ [key]: v });
    } }), h('span', { class: 'muted' }, suffix));
  const rrStatus = h('div', { class: 'muted' }, riff.status);
  riff.onChange((text) => { rrStatus.textContent = text; });
  onSettingsChange((st) => { rrBox.checked = st.riffRepeater; });

  // ---------- Wait mode ----------
  const waitBtn = h('button', { class: 'btn', onclick: () => wait.toggle() }, 'Wait mode: off');
  const waitInfo = h('div', { class: 'muted' }, 'The song stops at every note until you play it. Nothing is scored meanwhile. Pressing play skips a note.');
  wait.onChange(() => {
    waitBtn.textContent = wait.enabled ? 'Wait mode: on' : 'Wait mode: off';
    waitBtn.classList.toggle('primary', wait.enabled);
  });

  const section = h('section', {},
    h('h2', {}, 'Riff repeater & wait mode'),
    h('div', { class: 'row' }, h('button', { class: 'btn', title: 'Loop the section that is playing now', onclick: () => loopCurrentSection(adapter, notify) }, 'Loop this section'),
      showProgress ? h('button', { class: 'btn', onclick: () => showProgress() }, 'Weak spots') : null),
    h('label', { class: 'row muted' }, rrBox, 'Riff repeater: speed up automatically on a loop'),
    h('div', { class: 'row' }, h('span', { class: 'muted' }, 'Start at'), num('rrStartSpeed', 25, 100, 5, '%'),
      h('span', { class: 'muted' }, 'then +'), num('rrStep', 1, 25, 1, '%')),
    h('div', { class: 'row' }, h('span', { class: 'muted' }, 'when a pass reaches'), num('rrTarget', 50, 100, 1, '%'),
      h('span', { class: 'muted' }, 'up to'), num('rrMaxSpeed', 50, 150, 5, '%')),
    rrStatus,
    h('div', { class: 'row' }, waitBtn),
    waitInfo,
  );

  // ---------- Takes ----------
  const recBox = h('input', { type: 'checkbox', onchange: (e) => takes.setArmed(e.target.checked) });
  const list = h('div', {});
  const vol = h('input', { type: 'range', min: 0, max: 150, value: 100, oninput: () => takes.setVolume(Number(vol.value) / 100) });
  const fmtTime = (ms) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  function renderTakes() {
    recBox.checked = takes.armed;
    const playing = takes.playback ? takes.playback.take : null;
    list.replaceChildren(...(takes.takes.length ? takes.takes.map((t) => h('div', { class: 'row sc' },
      h('span', { class: 'grow' }, `Take ${t.id} · ${t.label}`, h('span', { class: 'muted' }, ` · ${fmtTime(t.recordedAt)}`)),
      t === playing
        ? h('button', { class: 'btn small primary', onclick: () => { adapter.pause(); takes.stopPlayback(); } }, '■ Stop')
        : h('button', { class: 'btn small', title: 'Play the song from this point with your take', onclick: () => takes.play(t) }, '▶ Play'),
      h('button', { class: 'btn small', title: 'Save as a WAV file', onclick: () => takes.download(t) }, 'Save'),
      h('button', { class: 'btn small', title: 'Delete', onclick: () => takes.remove(t) }, '✕'),
    )) : [h('div', { class: 'muted' }, takes.armed ? 'Recording: play the song, every run becomes a take.' : 'No takes yet.')]));
  }
  takes.onChange(renderTakes);
  renderTakes();

  const takesSection = h('section', {},
    h('h2', {}, 'Record & listen back'),
    h('label', { class: 'row muted' }, recBox, 'Record takes (needs the input on). Each run from play to pause, seek or loop restart is kept; the last 6 stay.'),
    list,
    h('div', { class: 'row' }, h('span', { class: 'muted' }, 'Take volume'), h('div', { class: 'grow' }, vol)),
    h('div', { class: 'muted' }, 'Playback starts the song just before the take, at the speed you recorded, with your bass in place of the tab\'s. Takes are kept until you reload the page; use Save to keep one.'),
  );

  return [section, takesSection];
}
