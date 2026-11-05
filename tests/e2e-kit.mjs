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
sys.path.insert(0, ${JSON.stringify(converter)})
import yaml
from rs2014conv.tabs import read_tab
song = pathlib.Path(sys.argv[1]); y = (song / 'song.yaml').read_text()
tab = read_tab(song / yaml.safe_load(y)['tab'])   # the real reader on the file Chrome sent
print('  READ TAB: %d bars, %d notes' % (len(tab.measures), sum(len(m.notes) for m in tab.measures)))
out = song / 'output' / 'Band - Song'; out.mkdir(parents=True, exist_ok=True)
print('== Reading tab'); print('  ' + ' | '.join(l for l in y.splitlines() if l and not l.startswith('#')))
(out / 'report.txt').write_text('x\\nPLEASE CHECK:\\n  * Listen at 1:02.\\n\\n')
(out / 'Song_v1_p.psarc').write_bytes(b'psarc')
# A finished project, as the real build leaves it: chart XML + the audio it is timed to.
import json, shutil
proj = out / 'project'; proj.mkdir(exist_ok=True)
beats = ''.join('<ebeat time="%.3f" measure="%d" />' % (0.5 * i, i // 4 + 1 if i % 4 == 0 else -1) for i in range(40))
notes = ''.join('<note time="%.3f" string="%d" fret="%d" sustain="0.250"%s />' % (2.0 + 0.5 * i, i % 4, i % 5, ' hammerOn="1"' if i == 3 else '') for i in range(24))
(proj / 'arr_bass_RS2.xml').write_text('<?xml version="1.0"?><song version="8"><title>Song</title><arrangement>Bass</arrangement>'
    '<songLength>20.000</songLength><tuning string0="-2" string1="0" string2="0" string3="0" string4="0" string5="0" /><capo>0</capo>'
    '<artistName>Band</artistName><ebeats count="40">' + beats + '</ebeats><sections count="1"><section name="verse" number="1" startTime="2.000" /></sections>'
    '<levels count="1"><level difficulty="0"><notes count="24">' + notes + '</notes><chords count="0" /></level></levels></song>')
shutil.copy(next(song.glob('*.wav')), proj / 'audio.wav')
(proj / 'Band_Song.rs2dlc').write_text(json.dumps({'ArtistName': {'Value': 'Band'}, 'Title': {'Value': 'Song'}, 'AudioFile': {'Path': 'audio.wav'},
    'Arrangements': [{'Case': 'Instrumental', 'Fields': [{'XML': 'arr_bass_RS2.xml'}]}]}))
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
out.conn = await page.locator('.kit [data-role=conn]').innerText();
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
// Test the finished CDLC on the highway (chart XML + audio from the helper).
out.testButton = await page.locator('.kit [data-role=test]').count();
await page.locator('.kit [data-role=test]').click();
await page.waitForFunction(() => /Testing the CDLC|Couldn't load/.test(document.getElementById('status').textContent), null, { timeout: 30000 });
out.testStatus = await page.locator('#status').innerText();
out.testChart = await page.evaluate(() => {
  const a = globalThis.bassTrainer.adapter;
  return { notes: a.chart.notes.length, tuning: a.chart.instrument.tuning, hopo: a.chart.notes[3].flags.hopo, sections: a.chart.sections.map((x) => x.name), bars: a.chart.bars.length, audio: a.audioName, offset: a.offset };
});
await page.waitForFunction(() => Number.isFinite(globalThis.bassTrainer.adapter.audio.duration), null, { timeout: 10000 });
out.testAudioDuration = await page.evaluate(() => globalThis.bassTrainer.adapter.audio.duration);
const songDir = path.join(songs, "Band - Love That's Gone");
out.saved = existsSync(songDir) ? { yaml: readFileSync(path.join(songDir, 'song.yaml'), 'utf8'), audioOk: statSync(path.join(songDir, 'Love Thats Gone.wav')).size === statSync(wav).size } : null;
if (shot) await page.screenshot({ path: `${shot}-kit.png` });
console.log(JSON.stringify(out, null, 1));
await ctx.close();
const ok = out.extensionId === ID && out.buildVisible && /Connected to RS2014converter/.test(out.conn) && Math.abs(out.offset - OFFSET) < 0.03 && Number(out.offsetInput) === Math.round(out.offset * 1000)
  && /starts at/.test(out.sync) && out.zip.some((f) => f.endsWith('/Love Thats Gone.wav')) && out.zip.some((f) => f.endsWith('/song.yaml'))
  && /Done!/.test(out.build) && out.checks.includes('Listen at 1:02.') && /Reading tab/.test(out.log)
  && new RegExp(`READ TAB: ${chart.bars.length} bars, ${chart.notes.length} notes`).test(out.log)
  && out.testButton === 1 && /Testing the CDLC/.test(out.testStatus) && out.testChart.notes === 24 && out.testChart.hopo
  && out.testChart.tuning.join() === '26,33,38,43' && out.testChart.bars === 10 && out.testChart.sections[0] === 'Verse'
  && out.testChart.audio === 'audio.wav' && out.testChart.offset === 0 && out.testAudioDuration > 1
  && out.saved && out.saved.audioOk && /chart_offset: 2\.3\d\d/.test(out.saved.yaml) && /audio: "Love Thats Gone.wav"/.test(out.saved.yaml);
rmSync(dir, { recursive: true, force: true });
console.log(ok ? 'PASS' : 'FAIL');
process.exit(ok ? 0 : 1);
