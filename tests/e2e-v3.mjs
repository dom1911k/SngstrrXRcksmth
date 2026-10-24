// End-to-end (0.13): a lesson step in the player, played by the fake
// microphone and passed; the lesson bar, saved progress, the "what I heard"
// log, the phrase loop and the Lessons dialog.
// Usage: node tests/e2e-v3.mjs [screenshot-prefix]
import { chromium } from 'playwright';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { makeDrill, drillById } from '../extension/src/core/drills.js';
import { lessonById } from '../extension/src/core/lessons.js';
import { renderPerformance, writeWav } from './synth.mjs';

const shot = process.argv[2];
const dir = mkdtempSync(path.join(tmpdir(), 'bt-'));
const step = lessonById('octaves').steps[0];
const chart = makeDrill(step.drill, { ...drillById(step.drill).defaults, bpm: step.bpm, bars: step.bars || 8 });
const LEAD = 8, CLICK = 5;
const { audio } = renderPerformance(chart, 0, chart.duration, { lead: LEAD });
for (let i = 0; i < 2400; i++) audio[Math.round(CLICK * 48000) + i] += (Math.random() - 0.5) * 0.8 * (1 - i / 2400);
const wav = path.join(dir, 'lesson.wav');
writeWav(wav, audio);

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
const id = new URL(sw.url()).host;
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('[console]', m.text()); });
await page.goto(`chrome-extension://${id}/player/player.html?lesson=octaves&step=0`);
await page.waitForTimeout(1500);
const out = {};
out.bar = await page.locator('#lessonBar').innerText();
out.chart = await page.evaluate(() => globalThis.bassTrainer.adapter.chart.meta.title);
await page.evaluate(async ([lead, click]) => {
  const { engine, adapter } = globalThis.bassTrainer;
  const { updateSettings } = await import('../src/core/settings.js');
  await updateSettings({ calibrationMs: 0, fineTuneMs: 0, autoTimingMs: 0, autoTiming: false, scoring: true, countIn: false, countInLoops: false });
  await new Promise((resolve) => {
    const off = engine.on('onset', (o) => {
      off();
      adapter.setOffset(10);
      adapter.seek(-(lead - click) + (performance.now() - engine.ctxToPerf(o.t)) / 1000);
      adapter.play();
      resolve();
    });
    engine.start({});
  });
}, [LEAD, CLICK]);
await page.waitForTimeout((chart.duration + LEAD) * 1000 + 4500);
out.after = await page.evaluate(async () => {
  const { session, tools } = globalThis.bassTrainer;
  const p = (await chrome.storage.local.get('lessonProgress')).lessonProgress || {};
  return {
    accuracy: session.stats().accuracy, progress: p.octaves,
    nextVisible: !document.querySelector('#lessonBar .btn.primary').hidden,
    heard: tools.detection.heard.length, heardFirst: tools.detection.heard[0] && tools.detection.heard[0].name,
  };
});
await page.keyboard.press('Escape');
// Panel: Note detection section and Loop this phrase.
out.panel = await page.evaluate(() => {
  const r = document.getElementById('bass-trainer-root').shadowRoot;
  const heads = [...r.querySelectorAll('h2')].map((x) => x.textContent);
  const phraseBtn = [...r.querySelectorAll('button')].find((b) => b.textContent === 'Loop this phrase');
  phraseBtn.click();
  const { adapter } = globalThis.bassTrainer;
  return { detection: heads.includes('Note detection'), loop: adapter.loop && [adapter.loop.start, adapter.loop.end].map((x) => +x.toFixed(2)) };
});
// Lessons dialog.
await page.locator('#lessonBar .btn.primary').click();
await page.waitForTimeout(500);
out.step2 = await page.locator('#lessonBar').innerText();
await page.click('#lessonsBtn');
await page.waitForTimeout(400);
out.dialog = await page.evaluate(() => ({
  lessons: document.querySelectorAll('.lesson').length,
  passedSteps: document.querySelectorAll('.lstep.passed').length,
  selected: document.querySelector('.lesson.on b').textContent,
}));
if (shot) await page.screenshot({ path: `${shot}-lessons.png` });
console.log(JSON.stringify(out, null, 1));
const ok = /step 1\/3/.test(out.bar) && out.after.accuracy >= 0.85 && out.after.progress && out.after.progress.passed.includes(0)
  && out.after.nextVisible && out.after.heard > 0 && out.panel.detection && out.panel.loop && out.panel.loop[1] > out.panel.loop[0]
  && /step 2\/3/.test(out.step2) && out.dialog.lessons === 9 && out.dialog.passedSteps >= 1;
console.log(ok ? 'PASS' : 'FAIL');
await ctx.close();
process.exit(ok ? 0 : 1);
