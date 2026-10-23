// End-to-end smoke test: loads the unpacked extension in Chromium with a fake
// microphone (a WAV file), on a stubbed songsterr.com page.
// Usage: node tests/e2e-phase1.mjs <wav> [screenshot.png]
import { chromium } from 'playwright';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const ext = path.resolve('extension');
const wav = path.resolve(process.argv[2]);
const shot = process.argv[3];
const ctx = await chromium.launchPersistentContext(mkdtempSync(path.join(tmpdir(), 'bt-')), {
  headless: true,
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: [
    `--disable-extensions-except=${ext}`, `--load-extension=${ext}`,
    '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
    `--use-file-for-fake-audio-capture=${wav}`, '--autoplay-policy=no-user-gesture-required',
  ],
  viewport: { width: 1280, height: 900 },
});
await ctx.route('https://www.songsterr.com/**', (r) => r.fulfill({ contentType: 'text/html', body: '<html><body style="background:#fff"><h1>Songsterr stub</h1></body></html>' }));
const page = await ctx.newPage();
page.on('console', (m) => console.log('[page]', m.text()));
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto('https://www.songsterr.com/a/wsa/test-tab-s1');
const host = page.locator('#bass-trainer-root');
await host.waitFor({ state: 'attached', timeout: 10000 });
await page.locator('#bass-trainer-root >> css=.launcher').click();
await page.locator('#bass-trainer-root >> css=button.btn:has-text("Start input")').click();
await page.waitForTimeout(2500);
const read = () => page.evaluate(() => {
  const r = document.querySelector('#bass-trainer-root').shadowRoot;
  return {
    note: r.querySelector('.tuner-note').textContent,
    cents: r.querySelector('.tuner-cents').textContent,
    info: r.querySelector('section').innerText,
  };
});
console.log(JSON.stringify(await read(), null, 1));
// Calibration against the WAV's regular plucks.
await page.locator('#bass-trainer-root >> css=button.btn:has-text("Calibrate")').click();
await page.waitForTimeout(16000);
const cal = await page.evaluate(() => {
  const r = document.querySelector('#bass-trainer-root').shadowRoot;
  return [...r.querySelectorAll('section')].pop().innerText;
});
console.log(cal);
if (shot) await page.screenshot({ path: shot });
await ctx.close();
