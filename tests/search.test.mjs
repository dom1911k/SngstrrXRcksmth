// Song search: bass tracks, tunings, filters, sorting, links.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bassResults, filterResults, sortResults, tuningInfo, isBassTrack, trackUrl, searchSongs, levelFrom } from '../extension/src/core/song-search.js';

const songs = JSON.parse(readFileSync('tests/fixtures/search-metallica.json', 'utf8'));
const base = { tunings: [], strings: [], diffMin: 1, diffMax: 10, includeUnrated: true, minViews: 0, styles: [], mainOnly: false, hideJunk: false, playableOnly: false, library: 'any' };

test('bass tracks from search results', () => {
  const rows = bassResults(songs);
  assert.ok(rows.length >= songs.length * 0.8, `${rows.length} rows`);
  assert.ok(rows.every((r) => r.tuningLow.length >= 4 && Math.min(...r.tuningLow) <= 36));
  const puppets = rows.find((r) => /Master of Puppets/.test(r.title));
  assert.equal(puppets.tuning, 'E Standard');
  assert.match(puppets.url, /^https:\/\/www\.songsterr\.com\/a\/wsa\/metallica-master-of-puppets-bass-tab-s\d+t\d+$/);
  assert.equal(isBassTrack({ instrumentId: 34, tuning: [64, 59, 55, 50, 45, 40] }), false);   // guitar tuning
  assert.equal(isBassTrack({ instrumentId: 43, tuning: [43, 38, 33, 28] }), true);
  assert.equal(tuningInfo([43, 38, 33, 26]).name, 'Drop D');
  assert.equal(tuningInfo([43, 38, 33, 28, 23]).name, 'B Standard (5-string)');
  assert.equal(trackUrl({ artist: 'AC/DC', title: 'Back In Black', songId: 5 }, 3), 'https://www.songsterr.com/a/wsa/ac-dc-back-in-black-bass-tab-s5t3');
});

test('filters and sorting', () => {
  const rows = bassResults(songs);
  const easy = filterResults(rows, { ...base, diffMax: 3, includeUnrated: false });
  assert.ok(easy.length > 0 && easy.every((r) => r.difficulty <= 3));
  const main = filterResults(rows, { ...base, mainOnly: true });
  assert.equal(new Set(main.map((r) => r.songId)).size, main.length);
  const pop = filterResults(rows, { ...base, minViews: 100000 });
  assert.ok(pop.every((r) => r.views >= 100000));
  const lib = new Map([[rows[0].key, { status: 'mastered' }]]);
  assert.ok(!filterResults(rows, { ...base, library: 'notMastered' }, lib).some((r) => r.key === rows[0].key));
  assert.ok(!filterResults(rows, { ...base, library: 'new' }, lib).some((r) => r.key === rows[0].key));
  assert.equal(filterResults(rows, { ...base, library: 'inLibrary' }, lib).length, 1);
  const byViews = sortResults(rows, 'views');
  assert.ok(byViews.every((r, i) => i === 0 || byViews[i - 1].views >= r.views));
  const byEasy = sortResults(rows.filter((r) => r.difficulty !== null), 'easy');
  assert.ok(byEasy.every((r, i) => i === 0 || byEasy[i - 1].difficulty <= r.difficulty));
  assert.equal(filterResults(rows, { ...base, excludeArtists: 'metallica' }).length, rows.filter((r) => !/metallica/i.test(r.artist)).length);
});

test('search request and level', async () => {
  let url = null;
  const data = await searchSongs({ pattern: 'x y', tuning: [26, 33, 38, 43], from: 100, size: 50, fetchImpl: async (u) => { url = u; return { ok: true, json: async () => [] }; } });
  assert.deepEqual(data, []);
  const q = new URL(url).searchParams;
  assert.equal(q.get('pattern'), 'x y');
  assert.equal(q.get('tuning'), '43,38,33,26');
  assert.equal(q.get('from'), '100');
  assert.equal(q.get('inst'), 'bass');
  assert.equal(levelFrom([{ difficulty: 2, stats: { bestFull: 0.95 } }, { difficulty: 4, stats: { bestFull: 0.91 } }, { difficulty: 5, stats: { bestFull: 0.5 } }]), 4);
  assert.equal(levelFrom([]), null);
});
