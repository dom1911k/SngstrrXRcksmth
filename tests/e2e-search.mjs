// End-to-end: the Find songs page against Songsterr's real search (needs network).
// Usage: node tests/e2e-search.mjs [screenshot-prefix]
import { chromium } from 'playwright';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const shot = process.argv[2];
const ext = path.resolve('extension');
const ctx = await chromium.launchPersistentContext(mkdtempSync(path.join(tmpdir(), 'bt-')), {
  headless: true,
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  viewport: { width: 1400, height: 900 },
});
let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent('serviceworker');
const id = new URL(sw.url()).host;
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => { errors.push(e.message); console.log('[pageerror]', e.message); });
await page.goto(`chrome-extension://${id}/search/search.html`);
const rows = () => page.evaluate(() => [...document.querySelectorAll('.srow')].map((r) => ({
  title: r.querySelector('.t b').textContent, tuning: r.querySelector('.tun').textContent,
  diff: r.querySelector('.diff span') ? Number(r.querySelector('.diff span').textContent) : null,
})));
await page.waitForSelector('.srow', { timeout: 30000 });
const out = { popular: (await rows()).length, count: await page.textContent('#count') };

await page.fill('#q', 'green day');
await page.click('#searchForm button');
await page.waitForTimeout(3000);
out.greenDay = (await rows()).slice(0, 5).map((r) => r.title);

await page.locator('.filters .chip:has-text("Drop D")').click();
await page.waitForTimeout(3500);
const drop = await rows();
out.dropD = { n: drop.length, allDrop: drop.every((r) => r.tuning === 'Drop D') };

await page.locator('.filters .chip:has-text("Drop D")').click();
await page.waitForTimeout(3000);
await page.selectOption('.filters .range select >> nth=1', '2');
await page.waitForTimeout(300);
const easy = await rows();
out.easy = { n: easy.length, ok: easy.every((r) => r.diff === null || r.diff <= 2) };

if (shot) await page.screenshot({ path: `${shot}-search.png` });
// + Want adds the song to the library.
const first = (await rows())[0];
await page.locator('.srow >> nth=0 >> button:has-text("+ Want")').click();
await page.waitForTimeout(500);
out.want = await page.evaluate(async (t) => {
  const { idbLibrary } = await import('../src/core/history-db.js');
  const all = await idbLibrary.all();
  const e = all.find((x) => x.title === t);
  return e && { status: e.status, difficulty: e.difficulty, url: e.url };
}, first.title);
// Open: new tab with the Songsterr bass tab, pending track switch stored.
const popupP = ctx.waitForEvent('page');
await page.locator('.srow >> nth=0 >> button:has-text("Open")').click();
const popup = await popupP;
out.openUrl = popup.url();
await popup.close();
out.pending = await page.evaluate(async () => (await chrome.storage.local.get('libraryPending')).libraryPending);
// Quick: Drop D songs, sorted by views.
await page.click('[data-quick="drop"]');
await page.waitForTimeout(3500);
const dq = await rows();
out.quickDrop = { n: dq.length, allDrop: dq.every((r) => r.tuning === 'Drop D') };

console.log(JSON.stringify(out, null, 1));
await ctx.close();
const ok = out.popular > 10 && out.greenDay.length >= 3 && out.dropD.n > 0 && out.dropD.allDrop && out.easy.n > 0 && out.easy.ok
  && out.want && out.want.status === 'want' && /songsterr\.com\/a\/wsa\/.*-bass-tab-s\d+t\d+/.test(out.want.url)
  && /songsterr\.com/.test(out.openUrl) && out.pending && out.pending.switchPart !== undefined
  && out.quickDrop.n > 0 && out.quickDrop.allDrop && !errors.length;
if (!ok) { console.error('FAIL'); process.exit(1); }
console.log('PASS');
