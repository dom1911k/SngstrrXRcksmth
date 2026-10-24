// End-to-end V2 tools in Chromium (standalone player, fake microphone playing
// a synthesized 21 Guns performance): takes recording + playback, practice
// history + progress card, wait mode, riff repeater.
// Usage: node tests/e2e-v2.mjs [screenshot-prefix]
import { chromium } from 'playwright';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { songsterrToChart } from '../extension/src/adapters/songsterr/to-chart.js';
import { renderPerformance, writeWav } from './synth.mjs';

const shot = process.argv[2];
const dir = mkdtempSync(path.join(tmpdir(), 'bt-'));
const chart = songsterrToChart(JSON.parse(readFileSync('tests/fixtures/21-guns-bass.json'))).chart;
const FROM = 40, TO = 56, LEAD = 2;
const { audio } = renderPerformance(chart, FROM, TO, { lead: LEAD });
const CLICK = 0.5;
for (let i = 0; i < 2400; i++) audio[Math.round(CLICK * 48000) + i] += (Math.random() - 0.5) * 0.8 * (1 - i / 2400);
const wav = path.join(dir, 'performance.wav');
writeWav(wav, audio);
const chartPath = path.join(dir, 'chart.json');
writeFileSync(chartPath, JSON.stringify(chart));

const ext = path.resolve('extension');
const ctx = await chromium.launchPersistentContext(path.join(dir, 'profile'), {
  headless: true,
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--autoplay-policy=no-user-gesture-required',
    '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wav}%noloop`,
    '--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
  viewport: { width: 1400, height: 850 },
});
let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent('serviceworker');
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => { errors.push(e.message); console.log('[pageerror]', e.message); });
page.on('console', (m) => { if (m.type() === 'error') console.log('[console]', m.text()); });
await page.goto(`chrome-extension://${new URL(sw.url()).host}/player/player.html`);
await page.waitForTimeout(800);
await page.setInputFiles('#openFiles', chartPath);
await page.waitForTimeout(300);

const out = {};
// 1. Play 40..54 with takes armed, aligned to the sync click (as e2e-scoring).
await page.evaluate(async ([from, lead, click]) => {
  const { engine, adapter, tools } = globalThis.bassTrainer;
  const { updateSettings } = await import('../src/core/settings.js');
  await updateSettings({ calibrationMs: 0, fineTuneMs: 0, autoTimingMs: 0, autoTiming: false, scoring: true, countIn: false, countInLoops: false, riffRepeater: false });
  await new Promise((resolve) => {
    const off = engine.on('onset', (o) => {
      off();
      const clickPerf = engine.ctxToPerf(o.t);
      adapter.seek(from - lead + click + (performance.now() - clickPerf) / 1000);
      adapter.play();
      resolve();
    });
    engine.start({}).then(() => tools.takes.setArmed(true));
  });
}, [FROM, LEAD, CLICK]);
await page.waitForTimeout(15000);
out.recorded = await page.evaluate(async () => {
  const { adapter, tools, session } = globalThis.bassTrainer;
  const judged = session.stats().judged;
  adapter.pause();
  await new Promise((r) => setTimeout(r, 300));
  adapter.seek(10); // ends the pass -> saved to the history
  await new Promise((r) => setTimeout(r, 900));
  const t = tools.takes.takes[0];
  let peak = 0;
  if (t) for (const x of t.samples) peak = Math.max(peak, Math.abs(x));
  const { records, stats } = await tools.history.load();
  return {
    judged, takes: tools.takes.takes.length, label: t && t.label, duration: t && +t.duration.toFixed(2), songStart: t && +t.songStart.toFixed(2), peak: +peak.toFixed(3),
    records: records.length, kind: records[0] && records[0].kind, accuracy: records[0] && records[0].accuracy, sections: stats.sections.length,
  };
});
// 2. Progress card.
await page.evaluate(() => globalThis.bassTrainer.overlay.showProgress());
await page.waitForTimeout(500);
out.card = await page.evaluate(() => {
  const root = document.getElementById('bass-trainer-highway').shadowRoot;
  const card = [...root.querySelectorAll('.card')].find((c) => !c.hidden);
  return card ? card.textContent.slice(0, 160) : null;
});
if (shot) await page.screenshot({ path: `${shot}-progress.png` });
await page.evaluate(() => { for (const c of document.getElementById('bass-trainer-highway').shadowRoot.querySelectorAll('.card')) c.hidden = true; });

// 3. Take playback lines up with the song.
out.playback = await page.evaluate(async () => {
  const { adapter, tools } = globalThis.bassTrainer;
  const take = tools.takes.takes[0];
  await tools.takes.play(take);
  await new Promise((r) => setTimeout(r, 2500));
  const p = tools.takes.playback;
  const res = { playing: adapter.getState().playing, source: !!(p && p.source), suspended: [...globalThis.bassTrainer.session.suspended] };
  if (p && p.source) {
    const ctx = tools.takes.ctx;
    const { takeOffsetFor } = await import('../src/core/takes.js');
    const actual = ctx.currentTime - p.startCtx + p.startOffset;
    const expected = takeOffsetFor(take, adapter.clock.estimate(globalThis.bassTrainer.engine.ctxToPerf(ctx.currentTime)));
    res.syncMs = Math.round((actual - expected) * 1000);
  }
  adapter.pause();
  tools.takes.stopPlayback();
  res.after = [...globalThis.bassTrainer.session.suspended];
  return res;
});

// 4. Wait mode stops on the first note after 44 s and continues on the right pitch.
out.wait = await page.evaluate(async () => {
  const { adapter, tools, session } = globalThis.bassTrainer;
  const wait = tools.wait;
  adapter.seek(44);
  wait.setEnabled(true);
  adapter.play();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 40 && wait.state !== 'waiting'; i++) await sleep(100);
  await sleep(400);
  const target = wait.target;
  const res = { state: wait.state, target: target && +target.t.toFixed(3), at: +adapter.getTime().toFixed(3), playing: adapter.getState().playing, message: wait.message };
  session.emit('played', { perf: performance.now(), midi: target.midi + 0.1, legato: false });
  await sleep(300);
  res.resumed = adapter.getState().playing;
  for (let i = 0; i < 40 && wait.state !== 'waiting'; i++) await sleep(100);
  res.next = wait.target && +wait.target.t.toFixed(3);
  return res;
});
if (shot) await page.screenshot({ path: `${shot}-wait.png` });
await page.evaluate(() => { const { tools, adapter } = globalThis.bassTrainer; tools.wait.setEnabled(false); adapter.pause(); });

// 5. Riff repeater: start speed on a loop, faster after a good full pass.
out.riff = await page.evaluate(async () => {
  const { adapter, session } = globalThis.bassTrainer;
  const { updateSettings } = await import('../src/core/settings.js');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  adapter.setLoop(40, 44);
  await updateSettings({ riffRepeater: true, rrStartSpeed: 70, rrStep: 5, rrTarget: 90 });
  await sleep(100);
  const start = adapter.getState().speed;
  session.emit('summary', { kind: 'loop', accuracy: 0.95, from: 40, judged: 8, hits: 8 });
  await sleep(100);
  return { start, after: adapter.getState().speed };
});

// 6. Input check: the fake microphone is silent now -> a warning on the highway.
out.warning = await page.evaluate(async () => {
  const { adapter } = globalThis.bassTrainer;
  const { updateSettings } = await import('../src/core/settings.js');
  await updateSettings({ riffRepeater: false });
  adapter.clearLoop();
  adapter.setSpeed(100);
  adapter.seek(70);
  adapter.play();
  const box = document.getElementById('bass-trainer-highway').shadowRoot.querySelector('.warnbox');
  for (let i = 0; i < 100 && box.hidden; i++) await new Promise((r) => setTimeout(r, 100));
  adapter.pause();
  return box.hidden ? null : box.textContent;
});
if (shot) await page.screenshot({ path: `${shot}-warning.png` });

console.log(JSON.stringify(out, null, 1));
await ctx.close();
const r = out.recorded, w = out.wait;
const ok = r.takes === 1 && r.duration > 10 && r.peak > 0.05 && r.records === 1 && r.kind === 'partial' && r.accuracy > 0.9
  && out.card && out.card.includes('Progress')
  && out.playback.playing && out.playback.source && Math.abs(out.playback.syncMs) <= 30 && out.playback.suspended.includes('take') && !out.playback.after.length
  && w.state === 'waiting' && !w.playing && Math.abs(w.at - (w.target + 0.06)) < 0.03 && w.resumed && w.next > w.target
  && Math.abs(out.riff.start - 0.7) < 1e-6 && Math.abs(out.riff.after - 0.75) < 1e-6
  && out.warning && /No sound|not recognised/.test(out.warning)
  && !errors.length;
if (!ok) { console.error('FAIL'); process.exit(1); }
console.log('PASS');
