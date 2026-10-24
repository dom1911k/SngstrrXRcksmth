// End-to-end: a drill in the player (fake microphone plays it), scored, saved
// and starred; then the Library page shows it with statistics, plus a
// Songsterr song with section / weak-spot details.
// Usage: node tests/e2e-library.mjs [screenshot-prefix]
import { chromium } from 'playwright';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { makeDrill } from '../extension/src/core/drills.js';
import { renderPerformance, writeWav } from './synth.mjs';

const shot = process.argv[2];
const dir = mkdtempSync(path.join(tmpdir(), 'bt-'));
const BPM = 100;
const chart = makeDrill('octaves', { bpm: BPM, bars: 6, position: 3 });
const FROM = 0, TO = chart.duration, LEAD = 8, CLICK = 5; // long silence first: the input must be running before the sync click
const { audio } = renderPerformance(chart, FROM, TO, { lead: LEAD });
for (let i = 0; i < 2400; i++) audio[Math.round(CLICK * 48000) + i] += (Math.random() - 0.5) * 0.8 * (1 - i / 2400);
const wav = path.join(dir, 'drill.wav');
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
const errors = [];
page.on('pageerror', (e) => { errors.push(e.message); console.log('[pageerror]', e.message); });
page.on('console', (m) => { if (m.type() === 'error') console.log('[console]', m.text()); });
await page.goto(`chrome-extension://${id}/player/player.html?drill=octaves&bpm=${BPM}&bars=6&pos=3`);
await page.waitForTimeout(1200);

const out = {};
out.loaded = await page.evaluate(() => { const c = globalThis.bassTrainer.adapter.chart; return c && c.meta.title; });
// Play the drill aligned to the sync click; count metronome clicks.
await page.evaluate(async ([lead, click]) => {
  const { engine, adapter } = globalThis.bassTrainer;
  const { updateSettings } = await import('../src/core/settings.js');
  await updateSettings({ calibrationMs: 0, fineTuneMs: 0, autoTimingMs: 0, autoTiming: false, scoring: true, countIn: false, countInLoops: false });
  globalThis.__clicks = 0;
  const orig = adapter.click.bind(adapter);
  adapter.click = (w, a) => { globalThis.__clicks++; orig(w, a); };
  await new Promise((resolve) => {
    const off = engine.on('onset', (o) => {
      off();
      // Song time 0 comes (lead - click) s after the click: start right away at
      // the matching negative time (allowed after shifting the chart's offset).
      adapter.setOffset(10);
      adapter.seek(-(lead - click) + (performance.now() - engine.ctxToPerf(o.t)) / 1000);
      adapter.play();
      resolve();
    });
    engine.start({});
  });
}, [LEAD, CLICK]);
await page.waitForTimeout((TO + LEAD) * 1000 + 4500);
out.drill = await page.evaluate(async () => {
  const { tools, session } = globalThis.bassTrainer;
  const { records, stats } = await tools.history.load();
  return { stopped: !globalThis.bassTrainer.adapter.isPlaying(), clicks: globalThis.__clicks, records: records.length, kind: records[0] && records[0].kind, bpm: records[0] && records[0].bpm, accuracy: records[0] && records[0].accuracy, seconds: records[0] && records[0].seconds, judged: session.stats().judged, weak: stats.weakBars.length };
});
// The Rocksmith-style end screen is up; Escape closes it. Then star the drill.
out.endScreen = await page.evaluate(() => {
  const e = document.getElementById('bass-trainer-highway').shadowRoot.querySelector('.endscreen');
  return e && !e.hidden ? e.innerText.replace(/\n+/g, ' | ').slice(0, 200) : null;
});
if (shot) await page.screenshot({ path: `${shot}-end.png` });
await page.keyboard.press('Escape');
await page.locator('#bass-trainer-highway >> css=button.star').click();
await page.waitForTimeout(400);
out.star = await page.evaluate(async () => {
  const { idbLibrary } = await import('../src/core/history-db.js');
  const e = await idbLibrary.get('drill:octaves');
  return { fav: e && e.favorite, kind: e && e.kind, label: document.getElementById('bass-trainer-highway').shadowRoot.querySelector('button.star').textContent };
});
// Fretboard trainer: answer 10 questions (the right pitch for most).
await page.evaluate(() => document.getElementById('drillsBtn').click());
await page.waitForTimeout(400);
await page.locator('.drill:has-text("Fretboard trainer")').click();
await page.locator('#drillStart').click();
await page.waitForTimeout(200);
await page.locator('.dialog.trainer select').first().selectOption('10');
await page.locator('.dialog.trainer button:has-text("Start")').click();
out.trainer = await page.evaluate(async () => {
  const t = globalThis.bassTrainerNoteTrainer();
  const { session } = globalThis.bassTrainer;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const prompts = [];
  for (let i = 0; i < 10; i++) {
    const q = t.round.q;
    prompts.push(document.querySelector('.dialog.trainer .tq').innerText.replace(/\n/g, ''));
    if (i === 2) { session.emit('played', { perf: performance.now() + 10, midi: q.midi + 2, legato: false }); await sleep(50); }
    session.emit('played', { perf: performance.now() + 10, midi: q.midi + 0.1, legato: false });
    await sleep(1000);
  }
  await sleep(300);
  return { prompts: prompts.slice(0, 3), done: document.querySelector('.dialog.trainer').innerText.slice(0, 80) };
});
await page.locator('.dialog.trainer button:has-text("Close")').click();
// Session report when the input stops.
await page.evaluate(() => globalThis.bassTrainer.engine.stop());
await page.waitForTimeout(800);
out.session = await page.evaluate(() => {
  const e = document.getElementById('bass-trainer-highway').shadowRoot.querySelector('.endscreen');
  return e && !e.hidden ? e.innerText.replace(/\n+/g, ' | ').slice(0, 220) : null;
});
if (shot) await page.screenshot({ path: `${shot}-session.png` });

// A Songsterr song with history (as if practised on Songsterr).
await page.evaluate(async () => {
  const { idbLibrary, idbHistory } = await import('../src/core/history-db.js');
  const bars = Array.from({ length: 12 }, (_, i) => ({ t: i * 2, end: i * 2 + 2, measure: i, section: i < 6 ? 'Verse' : 'Chorus' }));
  await idbLibrary.patch('songsterr:23557:5', { goal: { accuracy: 0.95, speed: 1, setAt: 0, by: Date.now() + 10 * 86400000 }, title: '21 Guns', artist: 'Green Day', track: 'Bass', kind: 'songsterr', url: 'https://www.songsterr.com/a/wsa/green-day-21-guns-tab-s23557t5', tuning: 'E Standard',
    layout: { bars, sections: [{ name: 'Verse', t: 0 }, { name: 'Chorus', t: 12 }] }, favorite: true, status: 'practising', lastOpenedAt: Date.now() });
  for (let k = 0; k < 6; k++) {
    const perBar = bars.map((_, b) => [b, b === 8 ? 0 : 4, b === 8 ? 3 : 0]);
    await idbHistory.add({ songKey: 'songsterr:23557:5', title: '21 Guns', artist: 'Green Day', barCount: 12, at: Date.now() - (20 - k) * 86400000, kind: 'song', speed: k < 2 ? 0.8 : 1,
      accuracy: 0.7 + k * 0.04, judged: 47, hits: 44, perBar, seconds: 200 });
  }
});

// Library page.
await page.goto(`chrome-extension://${id}/library/library.html#songs`);
await page.waitForTimeout(1200);
out.library = await page.evaluate(() => ({
  due: [...document.querySelectorAll('.duecard b')].map((b) => b.textContent),
  sessions: document.querySelectorAll('.sess').length,
  goal: (document.querySelector('.goalline') || {}).textContent,
  cards: [...document.querySelectorAll('.overview .card')].map((c) => c.innerText.replace(/\n/g, ' ')),
  rows: [...document.querySelectorAll('.row .title b')].map((b) => b.firstChild.textContent),
  chips: [...document.querySelectorAll('.chip')].map((c) => c.innerText.replace(/\n/g, ' ')),
}));
if (shot) await page.screenshot({ path: `${shot}-library.png` });
await page.locator('.row:has-text("21 Guns")').click();
await page.waitForTimeout(400);
out.detail = await page.evaluate(() => {
  const d = document.getElementById('detail');
  return { open: !d.hidden, sections: d.querySelectorAll('.sec').length, weak: [...d.querySelectorAll('table tr td:first-child')].map((t) => t.textContent), chart: !!d.querySelector('svg.histchart rect') };
});
if (shot) await page.screenshot({ path: `${shot}-detail.png` });
// "Practise" on a weak spot stores the request for the Songsterr page.
const popupPromise = ctx.waitForEvent('page');
await page.locator('#detail table button').first().click();
const popup = await popupPromise;
out.pending = await page.evaluate(async () => (await chrome.storage.local.get('libraryPending')).libraryPending);
out.popupUrl = popup.url();
await popup.close();

// ---- Hub: setup check, tiles, want shelf, setlists, views ----
await page.goto(`chrome-extension://${id}/library/library.html`);
await page.waitForTimeout(1500);
out.hub = await page.evaluate(() => ({
  setup: [...document.querySelectorAll('.setup-item .txt')].map((x) => x.textContent),
  tiles: [...document.querySelectorAll('.tile b')].map((x) => x.textContent),
}));
// Want to learn shelf.
await page.evaluate(async () => {
  const { idbLibrary } = await import('../src/core/history-db.js');
  await idbLibrary.patch('songsterr:99:1', { title: 'Hysteria', artist: 'Muse', kind: 'songsterr', status: 'want', tuning: 'E Standard', difficulty: 4, url: 'https://www.songsterr.com/a/wsa/muse-hysteria-bass-tab-s99t1' });
});
await page.reload();
await page.waitForTimeout(1200);
out.hub.shelf = await page.evaluate(() => [...document.querySelectorAll('.shelf-card b')].map((x) => x.textContent));
// New setlist (name via the prompt), add two songs from their details, play it.
page.once('dialog', (d) => d.accept('Rehearsal'));
await page.evaluate(() => { location.hash = '#setlists'; });
await page.waitForTimeout(200);
await page.locator('.setlist-card.new').click();
await page.evaluate(() => { location.hash = '#songs'; });
await page.waitForTimeout(200);
await page.waitForTimeout(500);
for (const t of ['21 Guns', 'Hysteria']) {
  await page.locator(`.row:has-text("${t}")`).first().click();
  await page.waitForTimeout(300);
  await page.locator('#detail .chip:has-text("Rehearsal")').click();
  await page.waitForTimeout(300);
}
await page.keyboard.press('Escape');
await page.evaluate(() => { location.hash = '#setlists'; });
await page.waitForTimeout(200);
out.hub.setlist = await page.evaluate(() => document.querySelector('.setlist-card:not(.new) .sl-title').innerText.replace(/\n/g, ' | '));
const slPopup = ctx.waitForEvent('page');
await page.locator('.setlist-card:not(.new) button:has-text("Play")').click();
const p2 = await slPopup;
out.hub.setlistOpened = p2.url();
await p2.close();
out.hub.run = await page.evaluate(async () => (await chrome.storage.local.get('setlistRun')).setlistRun);
// Views.
await page.evaluate(() => { location.hash = '#songs'; });
await page.waitForTimeout(200);
await page.locator('#viewToggle .chip:has-text("Grid")').click();
await page.waitForTimeout(300);
out.hub.grid = await page.evaluate(() => document.querySelectorAll('.gcard').length);
await page.selectOption('#group', 'tuning');
await page.waitForTimeout(300);
out.hub.groups = await page.evaluate(() => [...document.querySelectorAll('.ghead')].map((g) => g.firstChild.textContent));
if (shot) await page.screenshot({ path: `${shot}-grid.png`, fullPage: false });
await page.locator('#viewToggle .chip:has-text("Board")').click();
await page.waitForTimeout(300);
out.hub.board = await page.evaluate(() => [...document.querySelectorAll('.bcol')].map((c) => `${c.dataset.status}:${c.querySelectorAll('.bcard').length}`));
// Drop Hysteria on "Learning".
await page.evaluate(() => {
  const dt = new DataTransfer();
  dt.setData('text/plain', 'songsterr:99:1');
  document.querySelector('.bcol[data-status="learning"]').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true }));
});
await page.waitForTimeout(800);
out.hub.afterDrop = await page.evaluate(async () => { const { idbLibrary } = await import('../src/core/history-db.js'); return (await idbLibrary.get('songsterr:99:1')).status; });
await page.locator('#viewToggle .chip:has-text("List")').click();
await page.selectOption('#group', 'none');
await page.evaluate(() => { location.hash = '#home'; });
await page.waitForTimeout(400);
if (shot) await page.screenshot({ path: `${shot}-hub.png` });
await page.evaluate(() => { location.hash = '#progress'; });
await page.waitForTimeout(400);
out.hub.weekly = await page.evaluate(() => document.querySelectorAll('.weekchart rect').length);
if (shot) await page.screenshot({ path: `${shot}-progress.png` });

console.log(JSON.stringify(out, null, 1));
await ctx.close();
const d = out.drill;
const ok = out.loaded && /Octaves/.test(out.loaded)
  && d.stopped && d.clicks >= 20 && d.records === 1 && d.kind === 'song' && d.bpm === BPM && d.accuracy >= 0.9 && d.seconds > 5
  && out.endScreen && /SONG COMPLETE/.test(out.endScreen) && out.star.fav && out.star.kind === 'drill' && /Saved/.test(out.star.label)
  && out.trainer.done.includes('Round complete') && out.trainer.done.includes('90%') && /Play [A-G] on the [A-G] string/.test(out.trainer.prompts[0])
  && out.session && /SESSION REPORT/.test(out.session)
  && out.library.due.includes('21 Guns') && out.library.sessions >= 1 && /95% at 100% speed/.test(out.library.goal || '')
  && out.library.rows.some((r) => /Fretboard trainer/.test(r))
  && out.library.rows.includes('21 Guns') && out.library.rows.some((r) => /Octaves/.test(r)) && out.library.cards.length === 9
  && out.detail.open && out.detail.sections === 2 && out.detail.weak.some((w) => /Bar 9/.test(w)) && out.detail.chart
  && out.pending && out.pending.songKey === 'songsterr:23557:5' && out.pending.loopBars[0] === 7 && /songsterr/.test(out.popupUrl)
  && out.hub.tiles.length === 5 && !out.hub.tiles.includes("Continue") && out.hub.setup.some((t) => /input/i.test(t)) && out.hub.shelf.includes('Hysteria')
  && /Rehearsal/.test(out.hub.setlist) && /2 songs/.test(out.hub.setlist) && /songsterr/.test(out.hub.setlistOpened)
  && out.hub.run && out.hub.run.songKeys.length === 2 && out.hub.grid >= 4 && out.hub.groups.includes('E Standard')
  && out.hub.board.some((b) => b.startsWith('want:1')) && out.hub.afterDrop === 'learning' && out.hub.weekly === 12
  && !errors.length;
if (!ok) { console.error('FAIL', JSON.stringify({ errors, hub: out.hub, lib: out.library, drill: out.drill, session: out.session })); process.exit(1); }
console.log('PASS');
