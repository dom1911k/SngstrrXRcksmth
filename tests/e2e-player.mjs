// Standalone player end-to-end test: loads a chart (converted from a
// fixture) and an audio file, plays, changes speed, sets an A/B loop.
// Usage: node tests/e2e-player.mjs <audio.wav> [screenshot.png]
import { chromium } from 'playwright';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { songsterrToChart } from '../extension/src/adapters/songsterr/to-chart.js';

const [wav, shot] = process.argv.slice(2);
const dir = mkdtempSync(path.join(tmpdir(), 'bt-'));
const chartPath = path.join(dir, 'chart.json');
writeFileSync(chartPath, JSON.stringify(songsterrToChart(JSON.parse(readFileSync('tests/fixtures/21-guns-bass.json'))).chart));
const badPath = path.join(dir, 'bad.json');
writeFileSync(badPath, JSON.stringify({ format: 'bass-chart', version: 1, instrument: { tuning: [28, 33] }, notes: [] }));

const ext = path.resolve('extension');
const ctx = await chromium.launchPersistentContext(path.join(dir, 'profile'), {
  headless: true,
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--autoplay-policy=no-user-gesture-required', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
  viewport: { width: 1600, height: 900 },
});
let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent('serviceworker');
const id = new URL(sw.url()).host;
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`chrome-extension://${id}/player/player.html`);
await page.waitForTimeout(1000);
await page.setInputFiles('#chartFile', badPath);
await page.waitForTimeout(200);
const bad = await page.textContent('#status');
await page.setInputFiles('#chartFile', chartPath);
await page.setInputFiles('#audioFile', path.resolve(wav));
await page.fill('#offset', '-76000');
await page.dispatchEvent('#offset', 'change');
await page.click('#play');
await page.waitForTimeout(2000);
const t1 = Number(await page.evaluate(() => document.getElementById('bass-trainer-highway').dataset.time));
await page.waitForTimeout(1000);
const t2 = Number(await page.evaluate(() => document.getElementById('bass-trainer-highway').dataset.time));
await page.selectOption('#speed', '50');
await page.waitForTimeout(500);
const t3 = Number(await page.evaluate(() => document.getElementById('bass-trainer-highway').dataset.time));
await page.waitForTimeout(1000);
const t4 = Number(await page.evaluate(() => document.getElementById('bass-trainer-highway').dataset.time));
await page.click('#loopA');
await page.waitForTimeout(800);
await page.click('#loopB');
const loopTimes = [];
for (let i = 0; i < 10; i++) { await page.waitForTimeout(250); loopTimes.push(Number(await page.evaluate(() => document.getElementById('bass-trainer-highway').dataset.time))); }
if (shot) await page.screenshot({ path: shot });
const renderer = await page.evaluate(() => document.getElementById('bass-trainer-highway').dataset.renderer);
console.log(JSON.stringify({
  badChartRejected: /not a valid bass chart/.test(bad),
  rate100: +(t2 - t1).toFixed(2), rate50: +(t4 - t3).toFixed(2),
  loopRange: [Math.min(...loopTimes).toFixed(2), Math.max(...loopTimes).toFixed(2)], renderer,
}));
await ctx.close();
