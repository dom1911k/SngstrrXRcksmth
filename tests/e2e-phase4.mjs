// Phase 4 on the real Songsterr site (logged out): count-in handling,
// shortcuts, auto-mute status. Usage: node tests/e2e-phase4.mjs <mic.wav> [shot.png]
import { chromium } from 'playwright';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const [wav, shot] = process.argv.slice(2);
const ext = path.resolve('extension');
const ctx = await chromium.launchPersistentContext(mkdtempSync(path.join(tmpdir(), 'bt-')), {
  headless: true,
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--autoplay-policy=no-user-gesture-required',
    '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${path.resolve(wav)}`],
  viewport: { width: 1400, height: 900 },
});
const page = await ctx.newPage();
page.on('pageerror', (e) => { if (!/Failed to fetch/.test(e.message)) console.log('[pageerror]', e.message.slice(0, 200)); });
await page.goto('https://www.songsterr.com/a/wsa/green-day-21-guns-tab-s23557t5', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.locator('#bass-trainer-highway').waitFor({ state: 'attached', timeout: 30000 });
await page.waitForTimeout(8000);
await page.evaluate(() => {
  const seen = new Set();
  (function walk(v) {
    if (!v || typeof v !== 'object' || seen.has(v) || window.__st) return;
    seen.add(v);
    if (v.props && v.props.store && v.props.store.dispatch) { window.__st = v.props.store; return; }
    if (Array.isArray(v.__k)) v.__k.forEach(walk);
  })(document.getElementById('root').__k);
  window.__st.dispatch('player/toggleVideo', { open: false });
});
await page.waitForTimeout(2500);
const hl = () => page.evaluate(() => {
  const host = document.getElementById('bass-trainer-highway');
  const r = host.shadowRoot;
  return { time: Number(host.dataset.time), center: r.querySelector('.hud .center').textContent, notice: r.querySelector('.notice').textContent };
});
const st = () => page.evaluate(() => { const s = window.__st.get(); return { shouldPlay: s.player.shouldPlay, speed: s.player.speed, loop: [s.cursor.position.loopStart, s.cursor.position.loopEnd], cursor: s.player.instance.getCursor() }; });
const results = {};

// 1. Count-in: enabled in Songsterr; the highway should wait, then run.
await page.evaluate(() => { window.__st.dispatch('player/toggleCountIn'); window.__st.dispatch('player/togglePlay', { shouldPlay: true }); });
await page.waitForTimeout(1200);
results.duringCountIn = await hl();
await page.waitForTimeout(4500);
const a = await hl();
await page.waitForTimeout(1000);
const b = await hl();
results.afterCountIn = { advanced: +(b.time - a.time).toFixed(2), center: b.center };

// 2. Shortcuts on Songsterr's page.
await page.mouse.click(700, 200);
await page.keyboard.press('b');
await page.waitForTimeout(300);
results.loopB = { ...(await st()), notice: (await hl()).notice };
await page.keyboard.press('Minus');
await page.waitForTimeout(400);
results.speed = (await st()).speed;
await page.keyboard.press('Space');
await page.waitForTimeout(400);
results.afterSpace = (await st()).shouldPlay;
await page.keyboard.press('Space');
await page.waitForTimeout(400);
results.afterSpace2 = (await st()).shouldPlay;
await page.keyboard.press('c');
await page.waitForTimeout(300);
results.loopCleared = (await st()).loop;

// 2b. Escape leaves the full highway view (Highway -> Both).
const viewOn = () => page.evaluate(() => [...document.getElementById('bass-trainer-highway').shadowRoot.querySelectorAll('.bar button.on')].map((b) => b.textContent));
await page.locator('#bass-trainer-highway >> css=.bar button:has-text("Highway")').click();
await page.waitForTimeout(200);
const before = await viewOn();
await page.mouse.click(600, 600);
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
results.escape = { before, after: await viewOn() };

// 3. Auto-mute status after starting the input (logged out = no Plus).
await page.locator('#bass-trainer-root >> css=.launcher').click();
await page.locator('#bass-trainer-root >> css=button.btn:has-text("Start input")').click();
await page.waitForTimeout(2500);
results.muteStatus = await page.evaluate(() => {
  const r = document.querySelector('#bass-trainer-root').shadowRoot;
  const sec = [...r.querySelectorAll('section')].find((s) => s.innerText.startsWith('PRACTICE'));
  return sec ? [...sec.querySelectorAll('div.muted')].map((d) => d.innerText).filter(Boolean)[0] : null;
});
results.songsterrCountIn = await page.evaluate(() => window.__st.get().player.isCountin);
// 4. Library: the open song is remembered (with its Songsterr link); ☆ Save makes it a favourite.
await page.locator('#bass-trainer-highway >> css=button.star').click();
await page.waitForTimeout(800);
results.library = await page.evaluate(() => document.getElementById('bass-trainer-highway').shadowRoot.querySelector('button.star').textContent);
const libPage = await ctx.newPage();
await libPage.goto(`chrome-extension://${new URL((ctx.serviceWorkers()[0]).url()).host}/library/library.html`);
await libPage.waitForTimeout(1200);
results.libraryRows = await libPage.evaluate(() => [...document.querySelectorAll('.row')].map((r) => r.querySelector('.title').innerText.replace(/\n/g, ' · ') + (r.querySelector('.fav.on') ? ' ★' : '')));
await libPage.close();
if (shot) await page.screenshot({ path: shot });
console.log(JSON.stringify(results, null, 1));
await ctx.close();
