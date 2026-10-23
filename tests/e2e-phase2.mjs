// Phase 2 end-to-end test on the REAL Songsterr site (needs network):
// loads the extension, opens a bass tab, plays with Songsterr's synth and
// checks that the highway follows play / pause / seek / loop / speed.
// Usage: node tests/e2e-phase2.mjs [url] [screenshot-prefix]
import { chromium } from 'playwright';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const url = process.argv[2] || 'https://www.songsterr.com/a/wsa/green-day-21-guns-tab-s23557t5';
const shots = process.argv[3];
const ext = path.resolve('extension');
const ctx = await chromium.launchPersistentContext(mkdtempSync(path.join(tmpdir(), 'bt-')), {
  headless: true,
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--autoplay-policy=no-user-gesture-required'],
  viewport: { width: 1400, height: 900 },
});
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message.slice(0, 200)));
page.on('console', (m) => { if (/Bass Trainer/.test(m.text())) console.log('[console]', m.text()); });
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.locator('#bass-trainer-highway').waitFor({ state: 'attached', timeout: 30000 });
await page.waitForTimeout(8000);

const diag = () => page.evaluate(() => ({ ...document.getElementById('bass-trainer-highway').dataset }));
// Find Songsterr's store from the page world to drive playback like a user would.
await page.evaluate(() => {
  const seen = new Set();
  (function walk(v) {
    if (!v || typeof v !== 'object' || seen.has(v) || window.__st) return;
    seen.add(v);
    if (v.props && v.props.store && v.props.store.dispatch) { window.__st = v.props.store; return; }
    if (Array.isArray(v.__k)) v.__k.forEach(walk);
  })(document.getElementById('root').__k);
});
const cursor = () => page.evaluate(() => ({ c: window.__st.get().player.instance.getCursor() / 1000, perf: performance.now() }));
const dispatch = (ev, payload) => page.evaluate(([e, p]) => window.__st.dispatch(e, p), [ev, payload]);

// Compare the overlay's clock with Songsterr's cursor at the same moment.
async function syncError() {
  const r = await page.evaluate(() => {
    const host = document.getElementById('bass-trainer-highway');
    return new Promise((resolve) => setTimeout(() => {
      const d = host.dataset;
      const inst = window.__st.get().player.instance;
      resolve({ overlay: Number(d.time), overlayPerf: Number(d.perf), cursor: inst.getCursor() / 1000, perf: performance.now(), speed: window.__st.get().player.speed / 100, playing: window.__st.get().player.shouldPlay });
    }, 260));
  });
  // Bring the overlay sample to the cursor's timestamp.
  const adj = r.overlay + (r.playing ? ((r.perf - r.overlayPerf) / 1000) * r.speed : 0);
  return (adj - r.cursor) * 1000;
}

console.log('initial', await diag());
await dispatch('player/toggleVideo', { open: false });
await page.waitForTimeout(3000);
const results = {};

await dispatch('player/togglePlay', { shouldPlay: true });
await page.waitForTimeout(3000);
results.play = [await syncError(), await syncError(), await syncError()];
if (shots) await page.screenshot({ path: `${shots}-play.png` });

await dispatch('cursor/move', { ...(await page.evaluate(() => window.__st.get().cursor.position)), cursor: 60000 });
await page.waitForTimeout(800);
results.seek = [await syncError(), (await cursor()).c];

await dispatch('player/changeSpeed', { speed: 60 });
await page.waitForTimeout(1500);
results.speed60 = [await syncError(), await syncError()];

await dispatch('cursor/move', { cursor: 41188, loopStart: 41188, loopEnd: 43438 });
await page.waitForTimeout(6000);
results.loop = [await syncError(), await syncError(), await syncError()];

await dispatch('player/togglePlay', { shouldPlay: false });
await page.waitForTimeout(800);
results.pause = [await syncError()];
if (shots) await page.screenshot({ path: `${shots}-pause.png` });

const d = await diag();
console.log(JSON.stringify({ results: Object.fromEntries(Object.entries(results).map(([k, v]) => [k, v.map((x) => +Number(x).toFixed(2))])), diag: d }, null, 1));
await ctx.close();
