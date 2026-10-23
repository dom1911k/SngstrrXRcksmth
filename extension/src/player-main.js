// Standalone player page (extension page player/player.html): chart JSON +
// local audio file, same highway / tuner / calibration as on Songsterr.
import { loadSettings } from './core/settings.js';
import { AudioEngine } from './audio/engine.js';
import { LocalAdapter } from './adapters/local/adapter.js';
import { createPanel } from './ui/panel.js';
import { createOverlay } from './ui/overlay.js';
import { createSongSection } from './ui/song-section.js';

const $ = (id) => document.getElementById(id);
const fmt = (t) => {
  const s = Math.max(0, t);
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
};

await loadSettings();
const engine = new AudioEngine();
const adapter = new LocalAdapter();
let panel;
const songSection = createSongSection(adapter, { onTabTuning: (t) => panel && panel.setTabTuning(t) });
panel = createPanel(engine, { sections: [songSection] });
const overlay = createOverlay(adapter, { controlsGap: 0, headerGap: 78, fixedMode: 'highway' });
document.body.append(overlay.host, panel.host);
adapter.start();
globalThis.bassTrainer = { engine, adapter, panel, overlay };

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

window.addEventListener('keydown', (e) => {
  if (e.target.closest && e.target.closest('input, select, textarea')) return;
  const k = e.key;
  if (k === ' ') { adapter.toggle(); e.preventDefault(); }
  else if (k === 'ArrowLeft') adapter.seek(adapter.getTime() - 5);
  else if (k === 'ArrowRight') adapter.seek(adapter.getTime() + 5);
  else if (k === 'Home') adapter.seek(adapter.loop ? adapter.loop.start : 0);
  else if (k === '[') setLoopPoint('a');
  else if (k === ']') setLoopPoint('b');
  else if (k === 'Backspace') { pendingA = null; adapter.clearLoop(); }
  else if (k === '+' || k === '=' || k === '-') {
    const opts = [...$('speed').options].map((o) => Number(o.value));
    const i = opts.indexOf(Math.round(adapter.speed * 100));
    const next = opts[Math.max(0, Math.min(opts.length - 1, (i < 0 ? opts.indexOf(100) : i) + (k === '-' ? -1 : 1)))];
    $('speed').value = next;
    adapter.setSpeed(next);
  } else return;
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
