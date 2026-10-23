// End-to-end scoring in Chromium: the fake microphone plays a synthesized
// bass performance of 21 Guns (bars ~14-30) while the standalone player plays
// the same chart; checks the score, timing and the on-screen feedback.
// Usage: node tests/e2e-scoring.mjs [screenshot.png]
import { chromium } from 'playwright';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { songsterrToChart } from '../extension/src/adapters/songsterr/to-chart.js';
import { renderPerformance, writeWav } from './synth.mjs';

const shot = process.argv[2];
const dir = mkdtempSync(path.join(tmpdir(), 'bt-'));
const chart = songsterrToChart(JSON.parse(readFileSync('tests/fixtures/21-guns-bass.json'))).chart;
const FROM = 40, TO = 70, LEAD = 2;
const { audio } = renderPerformance(chart, FROM, TO, { lead: LEAD, perform: (n, i) => (i === 7 ? { midi: n.midi + 2 } : {}) });
// Sync click at 0.5 s (like a count-in): the test aligns the song to it.
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
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('[console]', m.text()); });
await page.goto(`chrome-extension://${new URL(sw.url()).host}/player/player.html`);
await page.waitForTimeout(800);
await page.setInputFiles('#chartFile', chartPath);
await page.waitForTimeout(300);
// No latency in this setup: calibration 0. When the sync click is detected,
// start the song so that the click lands on its place in the song.
await page.evaluate(async ([from, lead, click]) => {
  const { engine, adapter } = globalThis.bassTrainer;
  const { updateSettings } = await import('../src/core/settings.js');
  await updateSettings({ calibrationMs: 0, fineTuneMs: 0, autoTimingMs: 0, scoring: true, countIn: false, countInLoops: false });
  await new Promise((resolve) => {
    const off = engine.on('onset', (o) => {
      off();
      const clickPerf = engine.ctxToPerf(o.t);
      const target = from - lead + click;
      adapter.seek(target + (performance.now() - clickPerf) / 1000);
      adapter.play();
      resolve();
    });
    engine.start({});
  });
}, [FROM, LEAD, CLICK]);
await page.waitForTimeout((TO - FROM + LEAD) * 1000 - 3000);
if (shot) await page.screenshot({ path: shot });
await page.waitForTimeout(3500);
const result = await page.evaluate(([to]) => {
  const { session } = globalThis.bassTrainer;
  const inRange = session.scorer.pass.results.filter((r) => r.note.t < to);
  const s = session.currentSummary();
  const missed = inRange.filter((r) => r.status === 'miss').map((r) => `${r.note.t.toFixed(2)}s ${r.expectedName}${r.note.flags.dead ? '(dead)' : ''} played=${r.playedName} dt=${r.offsetMs}`);
  const hits = inRange.filter((r) => r.status === 'hit').length;
  return { missed, accuracy: hits / inRange.length, judged: inRange.length, hits, misses: inRange.length - hits, early: s.early, ontime: s.ontime, late: s.late, avgOffsetMs: s.avgOffsetMs, wrongNotes: s.wrongNotes, extras: s.extras };
}, [TO]);
console.log(JSON.stringify(result));
await ctx.close();
// One note was deliberately played wrong (a whole tone too high).
const ok = result.judged > 40 && result.misses <= 2 && result.wrongNotes.length >= 1;
if (!ok) { console.error('FAIL'); process.exit(1); }
console.log('PASS');
