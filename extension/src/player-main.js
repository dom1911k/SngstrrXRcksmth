// Standalone player page (extension page player/player.html): chart JSON +
// local audio file, same highway / tuner / calibration as on Songsterr.
import { loadSettings } from './core/settings.js';
import { AudioEngine } from './audio/engine.js';
import { LocalAdapter } from './adapters/local/adapter.js';
import { createPanel } from './ui/panel.js';
import { createOverlay } from './ui/overlay.js';
import { createSongSection } from './ui/song-section.js';
import { ScoringSession } from './scoring/session.js';
import { AutoMute } from './core/auto-mute.js';
import { createPracticeSection } from './ui/practice-section.js';
import { createShortcutActions, installShortcuts } from './core/shortcuts.js';
import { createPracticeTools } from './core/practice-tools.js';
import { DRILLS, drillById, makeDrill } from './core/drills.js';
import { songStats } from './core/library.js';
import { historyStore } from './core/history.js';
import { getSettings } from './core/settings.js';
import { TUNINGS } from './core/music.js';
import { createTrainingSections } from './ui/training-section.js';

const $ = (id) => document.getElementById(id);
const fmt = (t) => {
  const s = Math.max(0, t);
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
};

await loadSettings();
const engine = new AudioEngine();
const adapter = new LocalAdapter();
const session = new ScoringSession(engine, adapter);
let panel, overlay;
const songSection = createSongSection(adapter, { onTabTuning: (t) => panel && panel.setTabTuning(t), showSummary: () => overlay && overlay.scoreUI && overlay.scoreUI.showLast() });
const autoMute = new AutoMute(engine, adapter);
const practiceSection = createPracticeSection(adapter, autoMute);
const notify = (t) => overlay && overlay.notify(t);
const tools = createPracticeTools(engine, adapter, session, notify);
const training = createTrainingSections({ adapter, ...tools, notify, showProgress: () => overlay.showProgress() });
panel = createPanel(engine, { sections: [practiceSection[0], ...training, practiceSection[1], ...songSection] });
overlay = createOverlay(adapter, { controlsGap: 0, headerGap: 78, fixedMode: 'highway', session, ...tools });
document.body.append(overlay.host, panel.host);
installShortcuts(createShortcutActions(adapter, { notify, extra: tools.actions }));
adapter.start();
globalThis.bassTrainer = { engine, adapter, panel, overlay, session, autoMute, tools };

let statusTimer;
function status(text, ok = false) {
  const el = $('status');
  el.className = ok ? 'status ok' : 'status';
  el.textContent = text;
  clearTimeout(statusTimer);
  if (text && ok) statusTimer = setTimeout(() => { el.textContent = ''; }, 3500);
}

async function openFile(file) {
  if (!file) return;
  if (/\.json$/i.test(file.name) || file.type === 'application/json') {
    try {
      adapter.loadChartText(await file.text(), file.name);
      status(`Chart loaded: ${file.name}`, true);
    } catch (err) {
      status(err.message);
    }
  } else if (file.type.startsWith('audio/') || /\.(mp3|ogg|oga|opus|wav|m4a|aac|flac|webm)$/i.test(file.name)) {
    adapter.loadAudioFile(file);
    status(`Audio loaded: ${file.name}`, true);
  } else {
    status(`${file.name}: not a chart (.json) or audio file.`);
  }
  $('empty').hidden = !!adapter.chart;
}

$('chartFile').addEventListener('change', (e) => { openFile(e.target.files[0]); e.target.value = ''; });
$('audioFile').addEventListener('change', (e) => { openFile(e.target.files[0]); e.target.value = ''; });

// Drag & drop
let dragDepth = 0;
window.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; $('drop').hidden = false; });
window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('drop').hidden = true; } });
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', async (e) => {
  e.preventDefault();
  dragDepth = 0;
  $('drop').hidden = true;
  const files = [...e.dataTransfer.files].sort((a) => (/\.json$/i.test(a.name) ? -1 : 1));
  for (const f of files) await openFile(f);
});

// Transport
$('play').addEventListener('click', () => adapter.toggle());
$('restart').addEventListener('click', () => adapter.seek(adapter.loop ? adapter.loop.start : 0));
$('speed').addEventListener('change', (e) => adapter.setSpeed(Number(e.target.value)));
$('offset').addEventListener('change', (e) => adapter.setOffset(Number(e.target.value) / 1000));
let seeking = false;
$('seek').addEventListener('input', (e) => { seeking = true; adapter.seek((Number(e.target.value) / 1000) * adapter.duration()); });
$('seek').addEventListener('change', () => { seeking = false; });
$('loopA').addEventListener('click', () => setLoopPoint('a'));
$('loopB').addEventListener('click', () => setLoopPoint('b'));
$('loopClear').addEventListener('click', () => { pendingA = null; adapter.clearLoop(); });
adapter.on('error', (msg) => status(msg));

let pendingA = null;
function setLoopPoint(which) {
  const t = adapter.getTime();
  if (which === 'a') {
    pendingA = t;
    if (adapter.loop && adapter.loop.end > t) adapter.setLoop(t, adapter.loop.end);
    status(`Loop start ${fmt(t)}. Press B (or ]) at the loop end.`, true);
  } else {
    const a = pendingA !== null ? pendingA : adapter.loop ? adapter.loop.start : 0;
    if (t > a) { adapter.setLoop(a, t); adapter.seek(a); status(`Looping ${fmt(a)} – ${fmt(t)}`, true); }
  }
}

// Arrow keys seek (the other keys are the shared, configurable shortcuts).
window.addEventListener('keydown', (e) => {
  if (e.target.closest && e.target.closest('input, select, textarea')) return;
  if (e.key === 'ArrowLeft') adapter.seek(adapter.getTime() - 5);
  else if (e.key === 'ArrowRight') adapter.seek(adapter.getTime() + 5);
  else return;
  e.preventDefault();
});

// UI refresh
function ui() {
  requestAnimationFrame(ui);
  const t = adapter.getTime();
  const d = adapter.duration();
  $('time').textContent = `${fmt(t)} / ${fmt(d)}`;
  if (!seeking && d > 0) $('seek').value = Math.round((Math.max(0, t) / d) * 1000);
  $('play').textContent = adapter.isPlaying() ? '❚❚' : '▶';
  $('loopA').classList.toggle('on', !!adapter.loop || pendingA !== null);
  $('loopB').classList.toggle('on', !!adapter.loop);
}
requestAnimationFrame(ui);

// ---- Metronome ----
$('metro').addEventListener('change', (e) => adapter.setMetronome(e.target.checked));

// ---- Drills ----
let drillSel = null;
async function openDrills() {
  let records = [];
  try { records = await (await historyStore()).all(); } catch { /* no history yet */ }
  const list = $('drillList');
  list.replaceChildren();
  for (const d of DRILLS) {
    const st = songStats(records.filter((r) => r.songKey === `drill:${d.id}`).sort((a, b) => a.at - b.at));
    const b = document.createElement('button');
    b.className = 'drill';
    b.innerHTML = `<b></b><span class="small"></span><span class="best"></span>`;
    b.querySelector('b').textContent = d.name;
    b.querySelector('.small').textContent = d.description;
    b.querySelector('.best').textContent = st.passes ? `${st.passes} runs · best ${Math.round(st.best * 100)}%${st.bestBpm ? ` · 90%+ at ${st.bestBpm} BPM` : ''}` : 'Not played yet';
    b.addEventListener('click', () => selectDrill(d, st));
    list.append(b);
    if (!drillSel) selectDrill(d, st);
  }
  $('drills').hidden = false;
}
function selectDrill(d, st) {
  drillSel = d;
  for (const el of $('drillList').children) el.classList.toggle('on', el.querySelector('b').textContent === d.name);
  // Suggest the next tempo: 5 BPM above your best clean (90%+) run.
  const bpm = st && st.bestBpm ? st.bestBpm + 5 : d.defaults.bpm;
  $('drillBpm').value = bpm;
  $('drillBars').value = d.defaults.bars;
  $('drillPos').value = d.defaults.position;
  $('drillPos').disabled = d.id === 'lock-in';
  $('drillHint').textContent = st && st.bestBpm ? `You played this cleanly at ${st.bestBpm} BPM, so the tempo is set 5 BPM higher.` : '';
}
function startDrill(id, opts) {
  const tuning = TUNINGS[getSettings().tuningName] || TUNINGS['E Standard'];
  adapter.setChart(makeDrill(id, { ...opts, tuning }));
  $('empty').hidden = true;
  $('drills').hidden = true;
  status(`${drillById(id).name}: press play (Space). The click counts you in.`, true);
}
$('drillsBtn').addEventListener('click', openDrills);
$('drillCancel').addEventListener('click', () => { $('drills').hidden = true; });
$('drillStart').addEventListener('click', () => {
  if (!drillSel) return;
  startDrill(drillSel.id, { bpm: Number($('drillBpm').value), bars: Number($('drillBars').value), position: Number($('drillPos').value) });
});

// ---- Opened from the Library: ?song=<key> (saved chart + audio) or ?drill=<id> ----
const params = new URLSearchParams(location.search);
if (params.get('drill') && drillById(params.get('drill'))) {
  const d = drillById(params.get('drill'));
  const num = (k) => (params.get(k) ? { [k === 'pos' ? 'position' : k]: Number(params.get(k)) } : {});
  startDrill(d.id, { ...d.defaults, ...num('bpm'), ...num('bars'), ...num('pos') });
} else if (params.get('song')) {
  (async () => {
    const { idbLibrary } = await import('./core/history-db.js');
    const entry = await idbLibrary.get(params.get('song'));
    if (!entry || !entry.chart) { status('This song is not saved with its chart. Open the chart file again.'); return; }
    adapter.setChart(entry.chart);
    const audio = await idbLibrary.getAudio(entry.songKey);
    if (audio) adapter.loadAudioFile(new File([audio.blob], audio.name || 'audio', { type: audio.blob.type }));
    if (entry.audioOffset) { adapter.setOffset(entry.audioOffset); $('offset').value = Math.round(entry.audioOffset * 1000); }
    $('empty').hidden = true;
    status(`${entry.title} loaded from the library${audio ? ' with its audio' : ' (open the audio file to play along)'}.`, true);
  })();
}
if (location.hash === '#drills') openDrills();

// Saving a player song in the library (★) keeps its audio file too.
async function saveAudio(entry) {
  const file = adapter.lastFile;
  if (!entry || entry.kind !== 'local' || !entry.favorite || !file || entry.hasAudio === file.name) return;
  const { idbLibrary } = await import('./core/history-db.js');
  await idbLibrary.putAudio(entry.songKey, file, file.name);
  await idbLibrary.patch(entry.songKey, { hasAudio: file.name, audioOffset: adapter.offset });
  entry.hasAudio = file.name;
}
tools.library.onChange(saveAudio);
adapter.on('audio', () => saveAudio(tools.library.entry));
