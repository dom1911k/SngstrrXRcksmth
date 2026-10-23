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
  for (const d of DRILLS.filter((x) => !x.trainer)) {
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

test('spaced repetition: when a song is due again', async () => {
  const { dueInfo, reviewInterval } = await import('../extension/src/core/library.js');
  const now = Date.UTC(2026, 9, 20, 12);
  const st = (o) => ({ last: 0.9, days: 2, lastAt: now - 3 * DAY, trend: 0, ...o });
  assert.equal(dueInfo({ status: 'new', favorite: false }, st({}), now), null);       // not tracked
  assert.equal(dueInfo({ kind: 'drill', status: 'learning' }, st({}), now), null);
  assert.equal(dueInfo({ status: 'learning' }, st({ lastAt: null }), now).due, true);  // never played
  // Learning, 90% last time, 2 days: 1 × 1.5 × 1.5 = 2.25 days -> due after 3 days.
  assert.equal(reviewInterval({ status: 'learning' }, st({})), 2.25);
  assert.equal(dueInfo({ status: 'learning' }, st({}), now).due, true);
  // Mastered at 97% over 8 days: 7 × 2 × 3 = 42 days -> not due after 3 days.
  const m = dueInfo({ status: 'mastered' }, st({ last: 0.97, days: 8 }), now);
  assert.equal(m.due, false);
  assert.equal(Math.round(m.days), 42);
  // A dropping score makes it due right away.
  assert.match(dueInfo({ status: 'mastered' }, st({ last: 0.97, days: 8, trend: -0.1 }), now).reason, /dropping/);
});

test('goals: progress and reaching the goal', async () => {
  const { goalProgress, goalLabel, LibraryTracker, memoryLibrary } = await import('../extension/src/core/library.js');
  const now = Date.UTC(2026, 9, 20, 12);
  const goal = { accuracy: 0.9, speed: 1, setAt: now - 10 * DAY, by: now + 5 * DAY };
  const recs = [{ at: now - 20 * DAY, accuracy: 0.99, speed: 1 }, { at: now - 2 * DAY, accuracy: 0.95, speed: 0.8 }, { at: now - DAY, accuracy: 0.8, speed: 1 }];
  const g = goalProgress(goal, recs, now);
  assert.equal(g.best, 0.8);            // before the goal was set and slowed runs don't count
  assert.equal(g.reached, false);
  assert.equal(g.daysLeft, 5);
  assert.ok(Math.abs(g.fraction - 0.8 / 0.9) < 1e-9);
  assert.equal(goalProgress(goal, [...recs, { at: now, accuracy: 0.92, speed: 1 }], now).reached, true);
  assert.match(goalLabel(goal), /^90% at 100% speed by /);
  // The tracker marks the song Mastered when a pass reaches the goal.
  const store = memoryLibrary();
  await store.put({ songKey: 'k', status: 'practising', goal, favorite: true });
  const tr = new LibraryTracker({ on: () => {} }, { store: Promise.resolve(store) });
  tr.entry = await store.get('k');
  assert.equal(await tr.checkGoal({ songKey: 'k', speed: 1, accuracy: 0.85, at: now }), null);
  const e = await tr.checkGoal({ songKey: 'k', speed: 1, accuracy: 0.91, at: now });
  assert.equal(e.status, 'mastered');
  assert.equal(e.goal.reachedAt, now);
});

test('session report: songs, personal bests and drill tempos', async () => {
  const { buildReport } = await import('../extension/src/core/session-report.js');
  const start = Date.UTC(2026, 9, 20, 18), end = start + 30 * 60000;
  const recs = [
    { songKey: 'a', title: 'Song A', judged: 50, hits: 45, accuracy: 0.9, speed: 1, seconds: 200, at: start + 1 },
    { songKey: 'a', title: 'Song A', judged: 50, hits: 48, accuracy: 0.96, speed: 1, seconds: 200, at: start + 2 },
    { songKey: 'drill:octaves', title: 'Drill: Octaves', judged: 48, hits: 47, accuracy: 0.98, speed: 1, seconds: 30, bpm: 110, at: start + 3 },
  ];
  const r = buildReport(recs, { a: [{ accuracy: 0.92, speed: 1 }], 'drill:octaves': [{ accuracy: 0.95, speed: 1, bpm: 100 }] }, { start, end });
  assert.equal(r.wallSeconds, 1800);
  assert.equal(r.practiceSeconds, 430);
  assert.equal(r.passes, 3);
  assert.equal(r.songs[0].songKey, 'a');
  assert.equal(r.songs[0].newBest, true);
  assert.ok(r.highlights.some((h) => /New personal best on Song A: 96% \(was 92%\)/.test(h)));
  assert.ok(r.highlights.some((h) => /clean at 110 BPM \(was 100\)/.test(h)));
});

test('fretboard trainer: questions and answers', async () => {
  const { makeQuestion, judgeAnswer } = await import('../extension/src/core/note-trainer.js');
  const tuning = [28, 33, 38, 43];
  let seed = 1;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < 200; i++) {
    const q = makeQuestion({ tuning, maxFret: 5, naturalsOnly: true }, rnd);
    assert.ok(q.fret >= 0 && q.fret <= 5 && !q.name.includes('#'));
    assert.equal(q.midi, tuning[q.string] + q.fret);
  }
  const q = { string: 1, fret: 3, midi: 36, name: 'C' };
  assert.equal(judgeAnswer(q, 36.2).result, 'right');
  assert.equal(judgeAnswer(q, 48).result, 'octave');   // C on another string / octave
  assert.deepEqual(judgeAnswer(q, 38), { result: 'wrong', played: 'D' });
  assert.equal(judgeAnswer(q, null).result, 'unclear');
});
