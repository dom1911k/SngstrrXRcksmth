// RS2014 kit card in the standalone player: turn the bass tab you had open on
// Songsterr (or a chart opened here) into a Rocksmith 2014 CDLC.
//
//   1. Audio    open the song's audio file (one you own)
//   2. Sync     Auto-sync finds where the chart starts in the file; nudge it and
//               check by ear / on the highway ("Play from the first note")
//   3. Make it  Build CDLC (RS2014converter on this PC, one click) or download
//               the kit as a ZIP (chart + song.yaml with the offset + your audio)
import { h } from './dom.js';
import { kitFiles, zipFiles } from '../core/cdlc-kit.js';
import { analyzeAudio, estimateOffset } from '../core/auto-sync.js';
import { converterInfo, buildWithConverter, openConverterFolder, INSTALL_COMMAND, lastConverterError } from '../core/converter-link.js';

const fmtOff = (s) => `${s >= 0 ? '+' : '−'}${Math.abs(s).toFixed(3)} s`;

export const KIT_CSS = `
.kit { position: fixed; top: 92px; left: 14px; z-index: 2147482997; width: 360px; max-height: calc(100vh - 150px); overflow: auto;
  background: rgba(21,23,28,.97); border: 1px solid #3a3f49; border-radius: 12px; padding: 12px 14px 14px; box-shadow: 0 10px 40px rgba(0,0,0,.5); font-size: 13px; }
.kit[hidden], .kit [hidden] { display: none; }
.kit h3 { margin: 0 0 2px; font-size: 15px; color: #f2c418; display: flex; justify-content: space-between; align-items: center; }
.kit h3 button { background: none; border: 0; color: #9aa0aa; font-size: 18px; cursor: pointer; }
.kit .song { color: #c9cdd4; margin-bottom: 10px; }
.kit .step { border-top: 1px solid #2c2f36; padding: 9px 0 4px; }
.kit .step b.n { display: inline-grid; place-items: center; width: 20px; height: 20px; border-radius: 50%; background: #2a2e36; margin-right: 6px; font-size: 12px; }
.kit .step.done b.n { background: #1f4d33; color: #5fd38d; }
.kit .row { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; margin: 6px 0; }
.kit .small { color: #9aa0aa; font-size: 12px; }
.kit .ok { color: #5fd38d; } .kit .warn { color: #ffb347; } .kit .bad { color: #ff8b8f; }
.kit .off { font-variant-numeric: tabular-nums; min-width: 78px; text-align: center; font-weight: 700; }
.kit .btn.small { padding: 3px 8px; font-size: 12px; }
.kit .log { background: #0e1014; border-radius: 6px; padding: 6px 8px; font: 11px/1.4 ui-monospace, Consolas, monospace; color: #aeb5c4; max-height: 140px; overflow: auto; white-space: pre-wrap; }
.kit .checks { margin: 6px 0 0 16px; padding: 0; color: #ffb347; }
.kit progress { width: 100%; }
.kit .install { background: #0e1014; border: 1px solid #2c2f36; border-radius: 8px; padding: 8px 10px; margin-top: 6px; }
.kit .install ol { margin: 4px 0 6px 18px; padding: 0; color: #c9cdd4; }
.kit .conn { border-radius: 8px; padding: 7px 10px; margin: 0 0 8px; font-size: 12px; }
.kit .conn.ok { background: #10291a; color: #5fd38d; border: 1px solid #1d4a2e; }
.kit .conn.no { background: #2b2410; color: #f2c418; border: 1px solid #4a3d12; }
.kit .conn .why { color: #c9cdd4; margin-top: 3px; }
.kit .conn .raw { color: #8b919c; font-size: 11px; margin-top: 3px; }
`;

export function createKitUI({ adapter, notify = () => {}, onOffset = () => {} }) {
  document.head.append(h('style', {}, KIT_CSS));
  let kit = null;        // { chart, title, artist, url }
  let audioFile = null;
  let analysis = null;   // cached analyzeAudio() of audioFile
  let synced = false;
  let building = null;

  const songEl = h('div', { class: 'song' });
  const audioInput = h('input', { type: 'file', accept: 'audio/*,.mp3,.ogg,.wav,.m4a,.flac,.opus', hidden: true,
    onchange: (e) => { if (e.target.files[0]) setAudio(e.target.files[0]); e.target.value = ''; } });
  const audioName = h('span', { class: 'small' }, 'No audio yet');
  const offEl = h('span', { class: 'off' }, fmtOff(0));
  const syncMsg = h('div', { class: 'small', 'data-role': 'sync' }, 'Auto-sync finds where the chart starts in your file. Then play from the first note and listen.');
  const autoBtn = h('button', { class: 'btn primary', disabled: true, onclick: () => autoSync() }, '🎯 Auto-sync');
  const nudge = (d) => h('button', { class: 'btn small', title: `${d > 0 ? 'Later' : 'Earlier'} by ${Math.abs(d) * 1000} ms`, onclick: () => setOffset(adapter.offset + d, true) }, `${d > 0 ? '+' : '−'}${Math.abs(d) >= 0.1 ? Math.abs(d).toFixed(1) : Math.abs(d * 1000) + 'ms'}`);
  const playBtn = h('button', { class: 'btn', disabled: true, title: 'Play from 2 s before the first note: notes should cross the strings exactly when you hear them', onclick: () => playFromFirst() }, '▶ Play from the first note');
  const buildBtn = h('button', { class: 'btn primary', hidden: true, onclick: () => build() }, '⚡ Build CDLC');
  const zipBtn = h('button', { class: 'btn', onclick: () => downloadZip() }, '📦 Download kit (ZIP)');
  const buildInfo = h('div', { class: 'small', 'data-role': 'build' });
  // Not installed yet: the one-line installer.
  const copyBtn = h('button', { class: 'btn small primary', onclick: async () => {
    try { await navigator.clipboard.writeText(INSTALL_COMMAND); copyBtn.textContent = '✓ Copied'; } catch { copyBtn.textContent = 'Copy failed'; }
    setTimeout(() => { copyBtn.textContent = '📋 Copy install command'; }, 2500);
  } }, '📋 Copy install command');
  const installBox = h('div', { class: 'install', hidden: true, 'data-role': 'install' },
    h('b', {}, 'One-click building: install RS2014converter (once)'),
    h('ol', {}, h('li', {}, 'Copy the install command.'), h('li', {}, 'Press Win+R, paste it (Ctrl+V) and press Enter.'),
      h('li', {}, 'When it says "Done", click Check again.')),
    h('div', { class: 'small' }, 'No admin rights needed; about 15 GB and 10–30 minutes the first time. Afterwards install Wwise once (the installer shows you how).'),
    h('div', { class: 'row' }, copyBtn, h('button', { class: 'btn small', onclick: () => checkConverter() }, 'Check again')));
  const progress = h('progress', { max: 1, value: 0, hidden: true });
  const logEl = h('div', { class: 'log', hidden: true });
  const resultEl = h('div', {});
  const steps = [h('div', { class: 'step' }), h('div', { class: 'step' }), h('div', { class: 'step' })];
  // Always visible: is RS2014converter connected, and if not, why.
  const connEl = h('div', { class: 'conn no', 'data-role': 'conn' }, 'Checking for RS2014converter…');
  steps[0].append(h('div', {}, h('b', { class: 'n' }, '1'), h('b', {}, 'Audio')),
    h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => audioInput.click() }, 'Choose audio file…'), audioName, audioInput),
    h('div', { class: 'small' }, 'The song\'s recording, one you own (FLAC, WAV, MP3, OGG, M4A). The same recording Songsterr uses fits best.'));
  steps[1].append(h('div', {}, h('b', { class: 'n' }, '2'), h('b', {}, 'Sync')),
    h('div', { class: 'row' }, autoBtn, playBtn),
    h('div', { class: 'row' }, nudge(-0.1), nudge(-0.01), offEl, nudge(0.01), nudge(0.1)),
    syncMsg);
  steps[2].append(h('div', {}, h('b', { class: 'n' }, '3'), h('b', {}, 'Make the CDLC')),
    h('div', { class: 'row' }, buildBtn, zipBtn), buildInfo, installBox, progress, logEl, resultEl);
  const card = h('div', { class: 'kit', hidden: true },
    h('h3', {}, 'RS2014 CDLC kit', h('button', { title: 'Close', onclick: () => { card.hidden = true; } }, '×')),
    songEl, connEl, ...steps);
  document.body.append(card);

  function refresh() {
    steps[0].classList.toggle('done', !!audioFile);
    steps[1].classList.toggle('done', synced);
    autoBtn.disabled = !audioFile;
    playBtn.disabled = !audioFile;
    offEl.textContent = fmtOff(adapter.offset || 0);
    buildBtn.disabled = !!building || !audioFile;
    zipBtn.disabled = !!building;
  }

  function setOffset(s, manual = false) {
    adapter.setOffset(Math.round(s * 1000) / 1000);
    onOffset(adapter.offset);
    if (manual) synced = true;
    refresh();
  }

  function setAudio(file) {
    audioFile = file;
    analysis = null;
    synced = false;
    adapter.loadAudioFile(file);
    audioName.textContent = file.name;
    syncMsg.textContent = 'Now press Auto-sync.';
    syncMsg.className = 'small';
    refresh();
  }

  async function decode(file) {
    const buf = await file.arrayBuffer();
    const ctx = new OfflineAudioContext(1, 1, 44100);
    const audio = await ctx.decodeAudioData(buf);
    const n = audio.length, ch = audio.numberOfChannels;
    const mono = new Float32Array(n);
    for (let c = 0; c < ch; c++) { const d = audio.getChannelData(c); for (let i = 0; i < n; i++) mono[i] += d[i] / ch; }
    return { mono, sr: audio.sampleRate };
  }

  async function autoSync() {
    if (!audioFile || !kit) return;
    autoBtn.disabled = true;
    syncMsg.className = 'small';
    syncMsg.textContent = 'Listening to the file… (a few seconds)';
    try {
      if (!analysis) {
        const { mono, sr } = await decode(audioFile);
        await new Promise((r) => setTimeout(r, 30));   // let the message paint
        analysis = analyzeAudio(mono, sr);
      }
      const r = estimateOffset(kit.chart, analysis);
      if (!r) throw new Error('the chart has too few notes');
      setOffset(r.offset);
      synced = true;
      const sure = r.pitch > 0.6 && r.margin > 0.04;
      syncMsg.className = sure ? 'small ok' : 'small warn';
      syncMsg.textContent = sure
        ? `The chart starts at ${fmtOff(r.offset)} in your file (notes clearly heard). Play from the first note to check.`
        : r.pitch <= 0.6
          ? `Best guess ${fmtOff(r.offset)}, but the notes are hard to hear in this file: is it the same song and version? Check by ear and nudge.`
          : `Best guess ${fmtOff(r.offset)}; it also fits at ${fmtOff(r.runnerUp)}. Play from the first note and listen: if it's off, nudge or type the other value.`;
    } catch (err) {
      syncMsg.className = 'small bad';
      syncMsg.textContent = `Couldn't analyse the file: ${err.message}`;
    } finally {
      refresh();
    }
  }

  function playFromFirst() {
    const first = kit && kit.chart.notes.find((n) => !n.flags.ghost);
    adapter.seek(Math.max(-adapter.offset, (first ? first.t : 0) - 2));
    adapter.play();
  }

  function files() {
    return kitFiles(kit.chart, { title: kit.title, artist: kit.artist, url: kit.url,
      audioName: audioFile ? audioFile.name : '', offset: audioFile && synced ? adapter.offset : null });
  }

  async function downloadZip() {
    if (!kit) return;
    const { folder, files: list } = files();
    if (audioFile) list.push({ name: `${folder}/${audioFile.name}`, bytes: new Uint8Array(await audioFile.arrayBuffer()) });
    const a = h('a', { href: URL.createObjectURL(new Blob([zipFiles(list)], { type: 'application/zip' })), download: `${folder} (RS2014 kit).zip` });
    document.body.append(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
    notify(audioFile ? 'Kit downloaded: unzip it and drag the folder onto drop_song_folder_here.bat' : 'Kit downloaded: add the audio file, then drag the folder onto drop_song_folder_here.bat');
  }

  async function build() {
    if (!kit || !audioFile || building) return;
    const { folder, files: list } = files();
    logEl.hidden = false;
    logEl.textContent = '';
    resultEl.replaceChildren();
    progress.hidden = false;
    progress.removeAttribute('value');
    const lines = [];
    const log = (t) => { lines.push(t); if (lines.length > 300) lines.shift(); logEl.textContent = lines.join('\n'); logEl.scrollTop = logEl.scrollHeight; };
    building = buildWithConverter({ folder, files: list.map((f) => ({ name: f.name.split('/').pop(), text: f.text })), audioFile }, (m) => {
      if (m.type === 'upload') { progress.max = m.total; progress.value = m.done; buildInfo.textContent = `Sending the audio… ${Math.round((100 * m.done) / m.total)}%`; }
      if (m.type === 'saved') { progress.removeAttribute('value'); buildInfo.textContent = `Saved in ${m.dir}. Building… (a few minutes the first time)`; }
      if (m.type === 'step') buildInfo.textContent = m.text;
      if (m.type === 'log') log(m.line);
    });
    refresh();
    try {
      const done = await building.promise;
      progress.hidden = true;
      if (done.ok) {
        // Everything made, but maybe not the .psarc (Wwise missing / never started).
        buildInfo.className = done.psarc ? 'small ok' : 'small warn';
        buildInfo.textContent = !done.psarc
          ? 'Made everything except the .psarc (the Rocksmith file). Fix what\'s listed below, then open the RS2014 CDLC Maker, click this song and press "⟳ Build the .psarc again" (takes seconds).'
          : done.copiedTo ? 'Done! The CDLC is in your Rocksmith dlc folder: start Rocksmith.' : `Done! ${done.psarc}`;
        resultEl.replaceChildren(
          done.checks && done.checks.length ? h('div', {}, h('b', {}, 'Please check (from report.txt):'), h('ul', { class: 'checks' }, ...done.checks.map((c) => h('li', {}, c)))) : h('div', { class: 'small ok' }, 'Nothing to check in the report.'),
          h('div', { class: 'row' },
            h('button', { class: 'btn small', onclick: () => openConverterFolder(folder, 'output') }, 'Open output folder'),
            done.copiedTo ? h('button', { class: 'btn small', onclick: () => openConverterFolder(folder, 'dlc') }, 'Open dlc folder') : null));
        notify('CDLC built ✓');
      } else {
        buildInfo.className = 'small bad';
        buildInfo.textContent = `The build failed: ${done.error || 'see the log'}`;
      }
    } catch (err) {
      progress.hidden = true;
      buildInfo.className = 'small bad';
      buildInfo.textContent = `The build stopped: ${err.message}`;
    } finally {
      building = null;
      refresh();
    }
  }

  const WHY = {
    'no-permission': 'This version of the Bass Trainer can\'t talk to programs on your PC yet. Click Updates in the extension (0.15.0 or newer), then reload this page.',
    'not-found': 'Chrome doesn\'t know the converter. Its installer registers it at the end (step 7/8): run the install command again, let it finish, then click Check again. Still nothing: close Chrome completely and open it again.',
    forbidden: 'The converter is registered for a different extension. Run the install command again; if that doesn\'t help, tell Claude this extension ID: ' + (typeof chrome !== 'undefined' && chrome.runtime ? chrome.runtime.id : '?'),
    crashed: 'Chrome finds the converter, but it stops right away (its Python environment may be incomplete). Run the install command again: it repairs it.',
    'no-answer': 'The converter didn\'t answer in time. Click Check again; if it keeps happening, run the install command again.',
  };

  function showConnection(info) {
    if (info) {
      connEl.className = 'conn ok';
      connEl.replaceChildren(h('b', {}, '✓ Connected to RS2014converter'), h('div', { class: 'why' }, `Songs are saved in ${info.songsDir}`));
      return;
    }
    const e = lastConverterError || { code: 'no-answer', detail: '' };
    connEl.className = 'conn no';
    const version = typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest ? chrome.runtime.getManifest().version : '?';
    connEl.replaceChildren(h('b', {}, '✗ Not connected to RS2014converter'), h('div', { class: 'why' }, WHY[e.code] || WHY['no-answer']),
      h('div', { class: 'raw' }, `Chrome says: ${e.detail || '–'} · extension ${version}`),
      h('div', { class: 'row' }, h('button', { class: 'btn small', onclick: () => { connEl.replaceChildren('Checking…'); checkConverter(); } }, 'Check again')));
  }

  async function checkConverter() {
    const info = await converterInfo();
    showConnection(info);
    buildBtn.hidden = !info;
    buildInfo.className = 'small';
    installBox.hidden = !!info;
    buildInfo.textContent = info
      ? `RS2014converter found (${info.songsDir}).${info.dlcFolder ? ' The CDLC goes straight into your Rocksmith dlc folder.' : ''}${info.wwise === false ? ' Wwise is not installed yet: the build stops before the .psarc (the CDLC Maker app shows how to install it).' : ''}`
      : 'Or download the kit and build it with the RS2014 CDLC Maker / drop_song_folder_here.bat.';
  }

  return {
    open(k) {
      kit = k;
      songEl.textContent = `${k.artist} – ${k.title}`;
      if (adapter.lastFile && adapter.lastFile !== audioFile) { audioFile = adapter.lastFile; audioName.textContent = audioFile.name; analysis = null; }
      card.hidden = false;
      refresh();
      checkConverter();
    },
    get visible() { return !card.hidden; },
  };
}
