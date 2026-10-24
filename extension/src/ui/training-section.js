// Panel sections for V2 practice tools: riff repeater, wait mode, takes and
// progress (practice history).
import { h } from './dom.js';
import { getSettings, updateSettings, onSettingsChange } from '../core/settings.js';
import { loopCurrentSection } from '../core/riff-repeater.js';
import { SENSITIVITY } from '../core/detection.js';
import { loopCurrentPhrase } from '../core/phrases.js';

export function createTrainingSections({ adapter, riff, wait, takes, detection = null, notify = () => {}, showProgress = null }) {
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
    h('div', { class: 'row' }, h('button', { class: 'btn', title: 'Loop the phrase (2–4 bars) that is playing now', onclick: () => loopCurrentPhrase(adapter, notify) }, 'Loop this phrase'),
      h('button', { class: 'btn', title: 'Loop the section that is playing now', onclick: () => loopCurrentSection(adapter, notify) }, 'Loop this section'),
      showProgress ? h('button', { class: 'btn', onclick: () => showProgress() }, 'Weak spots') : null),
    h('label', { class: 'row muted' }, rrBox, 'Riff repeater: speed up automatically on a loop'),
    h('div', { class: 'row' }, h('span', { class: 'muted' }, 'Start at'), num('rrStartSpeed', 25, 100, 5, '%'),
      h('span', { class: 'muted' }, 'then +'), num('rrStep', 1, 25, 1, '%')),
    h('div', { class: 'row' }, h('span', { class: 'muted' }, 'when a pass reaches'), num('rrTarget', 50, 100, 1, '%'),
      h('span', { class: 'muted' }, 'up to'), num('rrMaxSpeed', 50, 150, 5, '%')),
    h('label', { class: 'row muted' }, h('input', { type: 'checkbox', checked: s.rrAdvance, onchange: (e) => updateSettings({ rrAdvance: e.target.checked }) }),
      'Phrase by phrase: when a loop is mastered, move on to the next phrase (after the last one, the whole section)'),
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

  return detection ? [section, takesSection, detectionSection(detection)] : [section, takesSection];
}

// ---------- Note detection: sensitivity, what the trainer heard, missed notes ----------
function detectionSection(log) {
  const s = getSettings();
  const select = (key, options, cast = String) => h('select', { onchange: (e) => updateSettings({ [key]: cast(e.target.value) }) },
    options.map(([v, label]) => h('option', { value: v, selected: String(s[key]) === String(v) }, label)));
  const heardEl = h('div', { class: 'detlist' });
  const missEl = h('div', { class: 'detlist' });
  const adviceEl = h('div', { class: 'warn', hidden: true });
  const ago = (at) => { const sec = Math.round((Date.now() - at) / 1000); return sec < 60 ? `${sec}s ago` : `${Math.round(sec / 60)} min ago`; };
  function render() {
    heardEl.replaceChildren(...(log.heard.length ? log.heard.slice(0, 8).map((e) => h('div', { class: 'row sc' },
      h('b', { style: { minWidth: '34px' } }, e.name), h('span', { class: 'muted grow' }, e.kind), h('span', { class: 'muted' }, ago(e.at))))
      : [h('div', { class: 'muted' }, 'Start the input and play a few notes: each note the trainer recognises appears here.')]));
    missEl.replaceChildren(...(log.misses.length ? log.misses.slice(0, 8).map((e) => h('div', { class: 'row sc' },
      h('span', { class: 'muted', style: { minWidth: '48px' } }, e.bar ? `bar ${e.bar}` : ''), h('span', { class: 'grow' }, e.text)))
      : [h('div', { class: 'muted' }, 'No missed notes yet.')]));
    const tip = log.advice(getSettings());
    adviceEl.textContent = tip;
    adviceEl.hidden = !tip;
  }
  let pending = false;
  log.onChange(() => { if (!pending) { pending = true; requestAnimationFrame(() => { pending = false; render(); }); } });
  render();
  return h('section', {},
    h('h2', {}, 'Note detection'),
    h('div', { class: 'row' }, h('span', { class: 'muted' }, 'Sensitivity'),
      select('detectSensitivity', Object.entries(SENSITIVITY).map(([k, v]) => [k, v.label]))),
    h('div', { class: 'row' }, h('span', { class: 'muted' }, 'Pitch tolerance'),
      select('pitchToleranceCents', [[40, 'Strict (±40 cents)'], [50, 'Normal (±50 cents)'], [70, 'Relaxed (±70 cents)']], Number)),
    h('div', { class: 'muted' }, 'If notes you play are often "nothing heard", raise the sensitivity. If the trainer picks up notes you didn\'t play (string noise), lower it.'),
    adviceEl,
    h('div', { class: 'sub' }, 'What I heard (newest first)'), heardEl,
    h('div', { class: 'sub' }, 'Missed notes and why'), missEl,
    h('div', { class: 'row' }, h('button', { class: 'btn small', onclick: () => log.clear() }, 'Clear')),
  );
}
