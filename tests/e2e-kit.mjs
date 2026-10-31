// End-to-end (0.15): the RS2014 kit in the player with RS2014converter's real Chrome
// helper (native messaging). The chart arrives as from the Songsterr panel, a synthetic
// recording (the chart's notes, starting 2.37 s into the file) is opened, Auto-sync finds
// the offset, "Build CDLC" sends the folder to the helper, which runs a stand-in for
// make_cdlc (the real one needs Windows, Wwise and the AI models).
// Usage: node tests/e2e-kit.mjs /path/to/rs2014converter [screenshot-prefix]
import { chromium } from 'playwright';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { songsterrToChart } from '../extension/src/adapters/songsterr/to-chart.js';
import { writeWav } from './synth.mjs';

const converter = path.resolve(process.argv[2] || '../rs2014converter');
const shot = process.argv[3];
if (!existsSync(path.join(converter, 'native_host', 'bass_trainer_host.py'))) { console.error(`RS2014converter not found at ${converter}`); process.exit(2); }
const dir = mkdtempSync(path.join(tmpdir(), 'bt-kit-'));
const OFFSET = 2.37;

// The chart (as the Songsterr panel stores it) and a recording of it.
const { chart } = songsterrToChart(JSON.parse(readFileSync(new URL('./fixtures/love-thats-gone-bass.json', import.meta.url))));
const sr = 22050;
const y = new Float32Array(Math.ceil((chart.duration + OFFSET + 2) * sr));
for (const n of chart.notes) {
  if (n.flags.ghost || n.flags.hopo || n.flags.slideTarget) continue;
  const f0 = 440 * 2 ** ((n.midi - 69) / 12), a = Math.round((n.t + OFFSET) * sr);
  for (let i = 0; i < Math.min(0.5, Math.max(0.15, n.dur)) * sr && a + i < y.length; i++) {
    const env = Math.exp(-i / (0.2 * sr)) * Math.min(1, i / 30);
    y[a + i] += 0.5 * env * (Math.sin(2 * Math.PI * f0 * i / sr) + 0.5 * Math.sin(4 * Math.PI * f0 * i / sr) + 0.25 * Math.sin(6 * Math.PI * f0 * i / sr));
  }
}
const wav = path.join(dir, 'Love Thats Gone.wav');
writeWav(wav, y, sr);

// The helper, registered for this test browser, with a stand-in build and its own songs folder.
const songs = path.join(dir, 'songs');
const fake = path.join(dir, 'fake_make.py');
writeFileSync(fake, `import sys, pathlib
song = pathlib.Path(sys.argv[1]); y = (song / 'song.yaml').read_text()
out = song / 'output' / 'Band - Song'; out.mkdir(parents=True, exist_ok=True)
print('== Reading tab'); print('  ' + ' | '.join(l for l in y.splitlines() if l and not l.startswith('#')))
(out / 'report.txt').write_text('x\\nPLEASE CHECK:\\n  * Listen at 1:02.\\n\\n')
(out / 'Song_v1_p.psarc').write_bytes(b'psarc')
`);
const runner = path.join(dir, 'host.py');
writeFileSync(runner, `import sys
sys.path.insert(0, ${JSON.stringify(path.join(converter, 'native_host'))})
import bass_trainer_host as bt
bt._binary_stdio()
host = bt.Host(build_cmd=[sys.executable, ${JSON.stringify(fake)}])
host.cfg["bass_trainer"] = {"songs_folder": ${JSON.stringify(songs)}}
while True:
    m = bt.read_message()
    if m is None: break
    try: host.handle(m)
    except Exception as e: bt.send({"type": "done", "ok": False, "error": str(e)})
`);
const py = process.env.PYTHON || 'python3';
const launcher = path.join(dir, 'host.sh');
writeFileSync(launcher, `#!/bin/sh\nexec ${py} ${JSON.stringify(runner)}\n`, { mode: 0o755 });
const profile = path.join(dir, 'profile');
mkdirSync(path.join(profile, 'NativeMessagingHosts'), { recursive: true });
const ID = 'gbbniikkcomblgdcdmbcanlcilmaeohh';   // fixed by the manifest key (setup.ps1 uses the same)
writeFileSync(path.join(profile, 'NativeMessagingHosts', 'com.basstrainer.rs2014converter.json'), JSON.stringify({
  name: 'com.basstrainer.rs2014converter', description: 'test', path: launcher, type: 'stdio', allowed_origins: [`chrome-extension://${ID}/`],
}));

const ext = path.resolve('extension');
const ctx = await chromium.launchPersistentContext(profile, {
  headless: true, executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', acceptDownloads: true,
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
  viewport: { width: 1400, height: 900 },
});
let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent('serviceworker');
const id = new URL(sw.url()).host;
const out = { extensionId: id };
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('[console]', m.text()); });
// As the Songsterr panel's "RS2014 CDLC kit" button does: chart into storage, open #kit.
await page.goto(`chrome-extension://${id}/updater/updater.html`);
await page.evaluate(async (c) => { await chrome.storage.local.set({ rsKit: { chart: c, title: "Love That's Gone", artist: 'Band', url: 'https://www.songsterr.com/x', at: Date.now() } }); }, chart);
await page.goto(`chrome-extension://${id}/player/player.html#kit`);
await page.waitForSelector('.kit:not([hidden])', { timeout: 10000 });
await page.waitForTimeout(1500);
out.buildVisible = await page.evaluate(() => [...document.querySelectorAll('.kit button')].some((b) => /Build CDLC/.test(b.textContent) && !b.hidden));
out.helper = await page.locator('.kit [data-role=build]').innerText();
await page.setInputFiles('.kit input[type=file]', wav);
await page.waitForTimeout(500);
await page.locator('.kit button:has-text("Auto-sync")').click();
await page.waitForFunction(() => /starts at|Best guess|Couldn/.test(document.querySelector('.kit [data-role=sync]').textContent), null, { timeout: 60000 });
out.sync = await page.locator('.kit [data-role=sync]').innerText();
out.offset = await page.evaluate(() => globalThis.bassTrainer.adapter.offset);
out.offsetInput = await page.inputValue('#offset');
// ZIP download (with the audio).
const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('.kit button:has-text("Download kit")').click()]);
out.zipName = dl.suggestedFilename();
const zipPath = path.join(dir, 'kit.zip');
await dl.saveAs(zipPath);
const { execFileSync } = await import('node:child_process');
out.zip = execFileSync('python3', ['-m', 'zipfile', '-l', zipPath]).toString().split('\n').slice(1).map((l) => l.replace(/\s+\d{4}-\d\d-\d\d .*$/, '').trim()).filter(Boolean);
// One-click build.
await page.locator('.kit button:has-text("Build CDLC")').click();
await page.waitForFunction(() => /Done!|failed|stopped/.test(document.querySelector('.kit [data-role=build]').textContent), null, { timeout: 60000 });
out.build = await page.locator('.kit [data-role=build]').innerText();
out.checks = await page.evaluate(() => [...document.querySelectorAll('.kit .checks li')].map((x) => x.textContent));
out.log = await page.locator('.kit .log').innerText();
const songDir = path.join(songs, "Band - Love That's Gone");
out.saved = existsSync(songDir) ? { yaml: readFileSync(path.join(songDir, 'song.yaml'), 'utf8'), audioOk: statSync(path.join(songDir, 'Love Thats Gone.wav')).size === statSync(wav).size } : null;
if (shot) await page.screenshot({ path: `${shot}-kit.png` });
console.log(JSON.stringify(out, null, 1));
await ctx.close();
const ok = out.extensionId === ID && out.buildVisible && Math.abs(out.offset - OFFSET) < 0.03 && Number(out.offsetInput) === Math.round(out.offset * 1000)
  && /starts at/.test(out.sync) && out.zip.some((f) => f.endsWith('/Love Thats Gone.wav')) && out.zip.some((f) => f.endsWith('/song.yaml'))
  && /Done!/.test(out.build) && out.checks.includes('Listen at 1:02.') && /Reading tab/.test(out.log)
  && out.saved && out.saved.audioOk && /chart_offset: 2\.3\d\d/.test(out.saved.yaml) && /audio: "Love Thats Gone.wav"/.test(out.saved.yaml);
rmSync(dir, { recursive: true, force: true });
console.log(ok ? 'PASS' : 'FAIL');
process.exit(ok ? 0 : 1);
