// Song library statistics and drills.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { songStats, overallStats, entryFields, LibraryTracker, memoryLibrary } from '../extension/src/core/library.js';
import { DRILLS, makeDrill } from '../extension/src/core/drills.js';
import { songKeyOf, recordFromSummary } from '../extension/src/core/history.js';
import { validateChart } from '../extension/src/core/chart.js';

const DAY = 86400000;

test('song statistics: best, best at full speed, trend, practice time, drill tempo', () => {
  const now = Date.UTC(2026, 9, 20, 12);
  const recs = [0.6, 0.7, 0.72, 0.8, 0.82, 0.85, 0.9, 0.93, 0.95, 0.97].map((a, i) => ({
    at: now - (10 - i) * DAY, accuracy: a, judged: 100, hits: Math.round(a * 100), speed: i < 5 ? 0.8 : 1, seconds: 120, bpm: 80 + i * 5,
  }));
  const st = songStats(recs);
  assert.equal(st.passes, 10);
  assert.equal(st.seconds, 1200);
  assert.equal(st.best, 0.97);
  assert.equal(st.bestFull, 0.97);
  assert.equal(st.days, 10);
  assert.ok(st.trend > 0.1, `trend ${st.trend}`);
  assert.equal(st.bestBpm, 125);         // 90%+ at bpm 80+9*5 at speed 1
  assert.equal(songStats([]).passes, 0);
});

test('overall: this week, streak, 28 days', () => {
  const now = Date.UTC(2026, 9, 20, 12);
  const recs = [0, 1, 2, 5, 20].map((d) => ({ at: now - d * DAY, accuracy: 0.9, judged: 10, hits: 9, songKey: `s${d % 2}`, seconds: 600 }));
  const o = overallStats(recs, now);
  assert.equal(o.streak, 3);
  assert.equal(o.weekPasses, 4);
  assert.equal(o.weekSeconds, 2400);
  assert.equal(o.days.length, 28);
  assert.equal(o.days[27].seconds, 600);
  assert.equal(o.weekAccuracy, 0.9);
  // Not practised today yet: yesterday's streak still counts.
  assert.equal(overallStats(recs.slice(1), now).streak, 2);
});

test('drills: valid charts, inside the fretboard, tempo ramp, saved per drill', () => {
  for (const d of DRILLS) {
    const c = makeDrill(d.id, { bpm: 100, bars: 8, position: 5 });
    assert.deepEqual(validateChart(c), [], d.id);
    assert.ok(c.notes.length >= 8 * 4, `${d.id}: ${c.notes.length} notes`);
    assert.ok(c.notes.every((n) => n.fret >= 0 && n.fret <= 20 && n.t >= c.bars[1].t - 1e-6), d.id);
    assert.equal(c.bars.length, 9);
    assert.equal(songKeyOf(c), `drill:${d.id}`);
  }
  const lock = makeDrill('lock-in', { bpm: 80, bars: 6 });
  assert.deepEqual(lock.bars.map((b) => b.bpm), [80, 80, 80, 84, 84, 88, 88]);
  const rec = recordFromSummary({ kind: 'song', judged: 30, hits: 29, accuracy: 29 / 30, speed: 1, seconds: 40, perBar: [] }, makeDrill('octaves', { bpm: 95 }));
  assert.equal(rec.bpm, 95);
  assert.equal(rec.seconds, 40);
});

test('library tracker: remembers opened songs and favourites', async () => {
  const listeners = new Map();
  const adapter = { on: (t, f) => listeners.set(t, f) };
  const store = memoryLibrary();
  const tr = new LibraryTracker(adapter, { store: Promise.resolve(store), url: () => 'https://www.songsterr.com/a/wsa/x-s1t2' });
  const chart = makeDrill('chromatic');
  chart.meta = { title: 'Song', artist: 'Band', source: { type: 'songsterr', songId: 1, partId: 2 } };
  await tr.onChart({ isBassLike: true, chart });
  assert.equal(tr.entry.songKey, 'songsterr:1:2');
  assert.equal(tr.entry.url, 'https://www.songsterr.com/a/wsa/x-s1t2');
  assert.equal(tr.entry.favorite, false);
  assert.equal(tr.entry.layout.bars.length, chart.bars.length);
  await tr.toggleFavorite();
  assert.equal((await store.get('songsterr:1:2')).favorite, true);
  assert.equal((await store.get('songsterr:1:2')).status, 'learning');
  assert.equal(entryFields(chart).kind, 'songsterr');
});
