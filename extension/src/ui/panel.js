// Panel: song & highway, input, tuner, monitoring and latency calibration.
import { h } from './dom.js';
import { PANEL_CSS } from './styles.js';
import { TUNINGS, noteName, stringColors, detectorMinFreq, tuningName } from '../core/music.js';
import { TunerModel } from '../core/tuner.js';
import { getSettings, updateSettings, totalLatencyMs, onSettingsChange } from '../core/settings.js';
import { runCalibration, CALIBRATION_DEFAULTS } from '../audio/calibration.js';

const dbfs = (v) => (v > 0 ? 20 * Math.log10(v) : -Infinity);

export function createPanel(engine, { sections = [] } = {}) {
  const settings = getSettings();
  const host = h('div', { id: 'bass-trainer-root' });
  const root = host.attachShadow({ mode: 'open' });
  root.append(h('style', {}, PANEL_CSS));
  // Keep Songsterr's keyboard shortcuts (space = play, etc.) from firing
  // while typing or using sliders inside the panel.
  for (const type of ['keydown', 'keyup', 'keypress']) {
    host.addEventListener(type, (e) => e.stopPropagation());
  }

  const TAB = '__tab__';
  let tabTuning = null;
  let tuning = TUNINGS[settings.tuningName] || TUNINGS['E Standard'];
  const tuner = new TunerModel({ tuning, refA: settings.refA });
  let level = { rms: 0, peak: 0 };
  let clipUntil = 0;
  let calibration = null;

  // ---------- Input ----------
  const startBtn = h('button', { class: 'btn primary', onclick: () => toggleInput() }, 'Start input');
  const deviceSelect = h('select', { class: 'grow', onchange: () => changeDevice() },
    h('option', { value: '' }, 'Press Start to list inputs'));
  const meterFill = h('div', { class: 'fill' });
  const meterPeak = h('div', { class: 'peak' });
  const levelText = h('span', { class: 'muted' }, '');
  const inputInfo = h('div', { class: 'muted' }, 'Not started.');

  const inputSection = h('section', {},
    h('h2', {}, 'Input'),
    h('div', { class: 'row' }, startBtn, deviceSelect),
    h('div', { class: 'meter' }, meterFill, meterPeak),
    h('div', { class: 'row' }, levelText),
    inputInfo,
  );

  // ---------- Tuner ----------
  const tuningSelect = h('select', { onchange: () => changeTuning(tuningSelect.value) },
    Object.keys(TUNINGS).map((name) => h('option', { value: name, selected: name === settings.tuningName }, name)));
  const noteEl = h('div', { class: 'tuner-note' }, '–');
  const centsEl = h('div', { class: 'tuner-cents' }, 'Play an open string');
  const needle = h('div', { class: 'needle', style: { left: '50%', opacity: 0.2 } });
  const scale = h('div', { class: 'needle-scale' },
    h('div', { class: 'zone', style: { left: '45%', width: '10%' } }),
    [-50, -40, -30, -20, -10, 0, 10, 20, 30, 40, 50].map((c) =>
      h('div', { class: c === 0 ? 'tick center' : 'tick', style: { left: `${50 + c}%` } })),
    needle);
  const stringsEl = h('div', { class: 'strings' });
  const mismatchEl = h('div', { class: 'warn' });

  const tunerSection = h('section', {},
    h('h2', {}, 'Tuner'),
    h('div', { class: 'row' }, h('span', { class: 'muted' }, 'Target tuning'), tuningSelect),
    noteEl, centsEl, scale, stringsEl, mismatchEl,
    h('div', { class: 'muted' }, 'Set automatically from the tab when a bass track is open.'),
  );

  // ---------- Monitoring ----------
  const monitorSlider = h('input', { type: 'range', min: 0, max: 100, value: 0, oninput: () => {
    engine.setMonitorLevel(Number(monitorSlider.value) / 100);
    monitorValue.textContent = monitorSlider.value === '0' ? 'Off' : `${monitorSlider.value}%`;
  } });
  const monitorValue = h('span', { class: 'muted' }, 'Off');
  const monitorLatency = h('div', { class: 'muted' });
  const lowLatencyBox = h('input', { type: 'checkbox', checked: settings.lowLatency, onchange: async () => {
    await updateSettings({ lowLatency: lowLatencyBox.checked });
    if (engine.running) await toggleInput(true);
  } });

  const monitorSection = h('section', {},
    h('h2', {}, 'Hear yourself (monitoring)'),
    h('div', { class: 'row' }, h('div', { class: 'grow' }, monitorSlider), monitorValue),
    h('div', { class: 'muted' }, 'What you hear here is always a little late: the sound goes cable → Windows → Chrome → wireless headset. Calibration can correct scoring for this delay, but not what you hear. See "Reducing delay" in the README.'),
    h('label', { class: 'row muted' }, lowLatencyBox, 'Smallest audio buffer (less delay; turn off if you hear crackles)'),
    monitorLatency,
  );

  // ---------- Latency calibration ----------
  const calBtn = h('button', { class: 'btn primary', onclick: () => toggleCalibration() }, 'Calibrate');
  const calDots = h('div', { class: 'dots' });
  const calStatus = h('div', {}, '');
  const calResult = h('div', { class: 'big' });
  const fineSlider = h('input', { type: 'range', min: -150, max: 150, step: 1, value: settings.fineTuneMs, oninput: () => {
    updateSettings({ fineTuneMs: Number(fineSlider.value) });
  } });
  const fineValue = h('span', { class: 'muted' });
  const chromeInfo = h('div', { class: 'muted' });

  const calSection = h('section', {},
    h('h2', {}, 'Latency calibration'),
    h('ol', { class: 'muted' },
      h('li', {}, 'Put on your headphones and press Calibrate.'),
      h('li', {}, `Listen to ${CALIBRATION_DEFAULTS.countIn} clicks, then pluck one short note (an open string is fine) exactly on each of the next ${CALIBRATION_DEFAULTS.clicks} clicks.`),
      h('li', {}, 'Play to what you hear. The tool measures how late your notes arrive and corrects all timing by that.'),
    ),
    h('div', { class: 'row' }, calBtn),
    calDots, calStatus, calResult,
    h('div', { class: 'row' }, h('span', { class: 'muted' }, 'Fine-tune'), h('div', { class: 'grow' }, fineSlider), fineValue),
    h('div', { class: 'muted' }, 'Fine-tune only changes how scoring judges your timing. It does not change what you hear. If notes you play in time are judged "late", move right; if "early", move left. The summary after a song suggests a value.'),
    chromeInfo,
  );

  // ---------- Updates ----------
  const updateBanner = h('div', { class: 'update', hidden: true });
  const launcherDot = h('span', { class: 'launcher-dot', hidden: true });

  const panel = h('div', { class: 'panel', hidden: true },
    h('header', {}, h('h1', {}, 'Bass Trainer'),
      h('button', { class: 'close', title: 'Close', onclick: () => { panel.hidden = true; } }, '×')),
    updateBanner, ...sections, inputSection, tunerSection, monitorSection, calSection);
  const launcher = h('button', { class: 'launcher', onclick: () => { panel.hidden = !panel.hidden; } }, 'BASS TRAINER', launcherDot);
  root.append(launcher, panel);

  // ---------- behaviour ----------
  function renderStrings() {
    const colors = stringColors(tuning.length);
    stringsEl.replaceChildren(...tuning.map((m, i) =>
      h('div', { class: 'string', 'data-i': i, style: { borderColor: colors[i] + '55', color: colors[i] } },
        noteName(m), h('span', { class: 'c' }, ''))));
  }

  function changeTuning(name) {
    tuning = name === TAB ? tabTuning : TUNINGS[name];
    tuner.setTuning(tuning, settings.refA);
    engine.setMinFreq(detectorMinFreq(tuning, settings.refA));
    if (name !== TAB) updateSettings({ tuningName: name });
    renderStrings();
  }

  // Called when a tab with a bass track is loaded: tune to the tab.
  function setTabTuning(t) {
    if (tabTuning && t.length === tabTuning.length && t.every((v, i) => v === tabTuning[i])) return;
    tabTuning = t;
    let opt = tuningSelect.querySelector(`option[value="${TAB}"]`);
    if (!opt) { opt = h('option', { value: TAB }); tuningSelect.prepend(opt); }
    opt.textContent = `From tab: ${tuningName(t)}`;
    tuningSelect.value = TAB;
    changeTuning(TAB);
  }

  async function toggleInput(restart = false) {
    if (engine.running && !restart) {
      await engine.stop();
      return;
    }
    startBtn.disabled = true;
    inputInfo.textContent = 'Starting… (allow microphone access if Chrome asks)';
    try {
      const s = getSettings();
      await engine.start({ deviceId: s.deviceId, deviceLabel: s.deviceLabel, minFreq: detectorMinFreq(tuning, s.refA), lowLatency: s.lowLatency });
    } catch (err) {
      inputInfo.innerHTML = '';
      inputInfo.append(h('span', { class: 'bad' }, describeError(err)));
    } finally {
      startBtn.disabled = false;
    }
  }

  async function changeDevice() {
    const id = deviceSelect.value;
    const label = deviceSelect.selectedOptions[0] ? deviceSelect.selectedOptions[0].textContent : '';
    await updateSettings({ deviceId: id, deviceLabel: label });
    if (engine.running) {
      await engine.start({ deviceId: id, deviceLabel: label, minFreq: detectorMinFreq(tuning, settings.refA), lowLatency: getSettings().lowLatency });
    }
  }

  engine.on('devices', (inputs) => {
    deviceSelect.replaceChildren(...inputs.map((d) =>
      h('option', { value: d.deviceId, selected: d.deviceId === engine.trackDeviceId() }, d.label || 'Unnamed input')));
  });

  engine.on('state', (st) => {
    startBtn.textContent = st.running ? 'Stop input' : 'Start input';
    startBtn.classList.toggle('primary', !st.running);
    calBtn.disabled = !st.running;
    if (st.running) {
      updateSettings({ deviceId: st.deviceId, deviceLabel: st.deviceLabel });
      const p = st.processing;
      const off = p.echoCancellation === false && p.noiseSuppression === false && p.autoGainControl === false;
      const looksLikeCable = /rocksmith|real ?tone/i.test(st.deviceLabel);
      inputInfo.replaceChildren(...[
        h('div', {}, `${st.sampleRate / 1000} kHz · `,
          off ? h('span', { class: 'good' }, 'voice processing off')
            : h('span', { class: 'bad' }, 'Chrome voice processing is ON (echo/noise/gain). Detection may suffer.')),
        looksLikeCable ? null : h('div', { class: 'warn' }, 'This input does not look like the Real Tone Cable. Pick it in the list above.'),
        st.inputSampleRate && st.inputSampleRate !== st.sampleRate
          ? h('div', { class: 'warn' }, `Cable runs at ${st.inputSampleRate / 1000} kHz but your headphones at ${st.sampleRate / 1000} kHz, so Chrome has to convert, which adds delay. Set the headphones to 48000 Hz in Windows (see README, "Reducing delay").`)
          : null,
        st.message ? h('div', { class: 'bad' }, st.message) : null,
      ].filter(Boolean));
      chromeInfo.textContent = `Chrome reports ${st.baseLatencyMs + st.outputLatencyMs} ms of output buffering (wireless headset latency comes on top).`;
    } else {
      inputInfo.replaceChildren(st.message ? h('span', { class: 'bad' }, st.message) : 'Stopped.');
      level = { rms: 0, peak: 0 };
    }
  });

  engine.on('level', (l) => {
    level = l;
    if (l.peak >= 0.98) clipUntil = performance.now() + 1500;
  });

  engine.on('frame', (f) => tuner.push(f));

  function renderLatency() {
    const s = getSettings();
    fineSlider.value = s.fineTuneMs;
    fineValue.textContent = `${s.fineTuneMs > 0 ? '+' : ''}${s.fineTuneMs} ms`;
    if (s.calibrationMs === null) {
      calResult.textContent = 'Not calibrated yet';
      monitorLatency.textContent = 'Latency: not calibrated yet. Run the calibration below.';
    } else {
      const total = totalLatencyMs(s);
      calResult.textContent = `Total latency: ${total} ms`;
      const when = s.calibratedAt ? new Date(s.calibratedAt).toLocaleString() : '';
      monitorLatency.textContent = `Measured total latency: ${total} ms (calibrated ${s.calibrationMs} ms ±${s.calibrationSpreadMs} ms${s.fineTuneMs ? `, fine-tune ${s.fineTuneMs > 0 ? '+' : ''}${s.fineTuneMs} ms` : ''}; ${when}). What you hear while monitoring is delayed by part of this.`;
    }
  }

  function toggleCalibration() {
    if (calibration) { calibration.cancel(); return; }
    const n = CALIBRATION_DEFAULTS.countIn + CALIBRATION_DEFAULTS.clicks;
    calDots.replaceChildren(...Array.from({ length: n }, () => h('div', { class: 'dot' })));
    calBtn.textContent = 'Cancel';
    calStatus.textContent = 'Get ready…';
    calibration = runCalibration(engine, (p) => {
      const idx = p.phase === 'countin' ? p.index : CALIBRATION_DEFAULTS.countIn + p.index;
      [...calDots.children].forEach((d, i) => {
        d.className = i < idx ? 'dot done' : i === idx && p.phase !== 'done' ? 'dot now' : 'dot';
      });
      calStatus.textContent = p.phase === 'countin' ? `Listen… ${p.of - p.index}`
        : p.phase === 'play' ? `Play on every click (${p.hits} notes detected)` : 'Analysing…';
    });
    calibration.promise.then(async (r) => {
      calibration = null;
      calBtn.textContent = 'Calibrate';
      if (!r.ok) {
        calStatus.replaceChildren(h('span', { class: r.cancelled ? 'muted' : 'bad' }, r.reason));
        return;
      }
      await updateSettings({ calibrationMs: r.offsetMs, calibrationSpreadMs: r.spreadMs, calibratedAt: Date.now() });
      const cls = r.quality === 'good' ? 'good' : r.quality === 'ok' ? 'warn' : 'bad';
      calStatus.replaceChildren(...[
        h('span', { class: cls }, `Saved. Consistency ±${r.spreadMs} ms (${r.quality}), ${r.used}/${r.total} notes used.`),
        r.quality === 'poor' ? h('div', { class: 'muted' }, 'Your notes were spread out a lot. Try again, keeping to short, clear plucks.') : null,
        r.offsetMs < 0 || r.offsetMs > 350 ? h('div', { class: 'warn' }, `${r.offsetMs} ms is unusual (expected roughly 40–250 ms). You may have played ahead of or behind the clicks. Consider running it again.`) : null,
      ].filter(Boolean));
      renderLatency();
    });
  }

  function describeError(err) {
    if (err && err.name === 'NotAllowedError') return 'Microphone access was blocked. Click the camera/mic icon in Chrome\'s address bar, allow the microphone for songsterr.com, then press Start again.';
    if (err && err.name === 'NotFoundError') return 'No audio input found. Is the Real Tone Cable plugged in?';
    if (err && err.name === 'NotReadableError') return 'The input is busy or failed to open. Close other apps using the cable (e.g. Rocksmith, DAWs) and try again.';
    return `Could not start input: ${err && err.message ? err.message : err}`;
  }

  // Render loop (only does work while the panel is visible). Only writes to
  // the DOM when a value actually changed, to avoid needless page re-layouts.
  const put = (el, prop, v) => { if (el[prop] !== v) el[prop] = v; };
  // Browsers normalise style values (e.g. colours to rgb()), so remember what we set.
  const lastCss = new WeakMap();
  const css = (el, key, v) => {
    let m = lastCss.get(el);
    if (!m) lastCss.set(el, (m = {}));
    if (m[key] !== v) { m[key] = v; el.style[key] = v; }
  };
  let shownNote = '';
  let shownMismatch = '';
  function frame() {
    requestAnimationFrame(frame);
    if (panel.hidden) return;
    const rmsDb = dbfs(level.rms), peakDb = dbfs(level.peak);
    const pct = (db) => `${Math.max(0, Math.min(100, ((db + 60) / 60) * 100)).toFixed(1)}%`;
    css(meterFill, 'width', pct(rmsDb));
    css(meterPeak, 'left', pct(peakDb));
    if (engine.running) {
      const clipping = performance.now() < clipUntil;
      put(levelText, 'className', clipping ? 'bad' : 'muted');
      put(levelText, 'textContent', clipping ? 'Clipping! Lower the cable input level in Windows sound settings.'
        : peakDb > -60 ? `Peak ${peakDb.toFixed(0)} dBFS${peakDb < -30 && level.rms > 0.0005 ? ' (quiet: aim for -20…-6 when plucking hard)' : ''}` : 'No signal');
    } else {
      put(levelText, 'textContent', '');
    }

    const r = tuner.reading;
    if (r) {
      if (r.note !== shownNote) {
        const m = r.note.match(/^([A-G]#?)(-?\d+)$/);
        noteEl.replaceChildren(m[1], h('small', {}, m[2]));
        shownNote = r.note;
      }
      const c = Math.round(r.cents);
      put(centsEl, 'textContent', `${c > 0 ? '+' : ''}${c} cents · ${r.freq.toFixed(2)} Hz`);
      const shown = r.string >= 0 ? r.stringCents : r.cents;
      css(needle, 'left', `${(50 + Math.max(-50, Math.min(50, shown))).toFixed(1)}%`);
      css(needle, 'opacity', '1');
      css(needle, 'background', Math.abs(shown) <= 3 ? '#5fd38d' : Math.abs(shown) <= 10 ? '#f2c418' : '#ff5a5f');
      css(noteEl, 'color', Math.abs(r.cents) <= 3 ? '#5fd38d' : '#e8e8ea');
    } else {
      css(needle, 'opacity', '0.2');
    }
    [...stringsEl.children].forEach((el, i) => {
      const active = !!(r && r.string === i);
      if (el.classList.contains('active') !== active) el.classList.toggle('active', active);
      put(el.querySelector('.c'), 'textContent', active ? `${r.stringCents > 0 ? '+' : ''}${Math.round(r.stringCents)}¢` : '');
    });
    const mm = tuner.mismatch();
    const target = tuningSelect.value === TAB ? 'this tab' : tuningSelect.value;
    const text = mm.map((w) => `⚠ ${w.text} for ${target}.`).join('\n');
    if (text !== shownMismatch) {
      shownMismatch = text;
      mismatchEl.replaceChildren(...mm.map((w) => h('div', {}, `⚠ ${w.text} for ${target}.`)));
    }
  }

  async function checkUpdates() {
    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) return;
    try {
      const { justUpdated } = await chrome.storage.local.get('justUpdated');
      if (justUpdated && Date.now() - justUpdated.at < 10 * 60 * 1000) {
        updateBanner.className = 'update done';
        updateBanner.replaceChildren(`Updated to version ${justUpdated.to}.`);
        updateBanner.hidden = false;
        chrome.storage.local.remove('justUpdated');
        return;
      }
      const r = await chrome.runtime.sendMessage({ type: 'checkUpdate' });
      if (r && r.available) {
        updateBanner.className = 'update';
        updateBanner.replaceChildren(
          h('span', {}, `Update available: ${r.current} → ${r.latest}`),
          h('button', { class: 'btn primary', onclick: () => chrome.runtime.sendMessage({ type: 'openUpdater' }) }, 'Update'));
        updateBanner.hidden = false;
        launcherDot.hidden = false;
      }
    } catch (err) {
      // Extension was reloaded/updated while this tab stayed open.
      console.warn('[Bass Trainer] update check failed', err);
    }
  }

  renderStrings();
  renderLatency();
  onSettingsChange(renderLatency);
  checkUpdates();
  calBtn.disabled = true;
  requestAnimationFrame(frame);

  return { host, open: () => { panel.hidden = false; }, setTabTuning };
}
