// Find songs (extension page search/search.html): Songsterr's search with
// bass-specific filters, your library and quick searches.
import { h } from './ui/dom.js';
import { idbHistory, idbLibrary } from './core/history-db.js';
import { songStats, setPending, coverOf, STATUSES } from './core/library.js';
import { searchSongs, bassResults, filterResults, sortResults, TUNING_CHOICES, PLAY_STYLES, levelFrom } from './core/song-search.js';

const $ = (id) => document.getElementById(id);
const PAGE = 100;
const MAX_PATTERNS = 8;
const STORE_KEY = 'btSongSearch';

const DEFAULT_FILTERS = {
  tunings: [], strings: [], diffMin: 1, diffMax: 7, includeUnrated: true, minViews: 0, styles: [],
  mainOnly: true, hideJunk: true, playableOnly: true, library: 'any', excludeArtists: '',
};

let filters = { ...DEFAULT_FILTERS };
let query = '';
let sortBy = 'relevance';
try {
  const saved = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
  filters = { ...DEFAULT_FILTERS, ...(saved.filters || {}) };
  query = saved.query || '';
  sortBy = saved.sortBy || 'relevance';
} catch { /* first visit */ }
const save = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify({ filters, query, sortBy })); } catch { /* private window */ } };

let songs = new Map();        // songId -> song (merged over patterns and pages, in order)
let cursors = [];             // [{ pattern, from, done }]
let library = new Map();
let stats = new Map();
let busy = false;
let note = '';

const fmtViews = (v) => (v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${Math.round(v / 1e3)}k` : String(v || 0));
const pct = (x) => (x === null || x === undefined ? '–' : `${Math.round(x * 100)}%`);

async function loadLibrary() {
  const [lib, recs] = await Promise.all([idbLibrary.all(), idbHistory.all()]);
  library = new Map(lib.map((e) => [e.songKey, e]));
  const by = new Map();
  for (const r of recs.sort((a, b) => a.at - b.at)) { if (!by.has(r.songKey)) by.set(r.songKey, []); by.get(r.songKey).push(r); }
  stats = new Map([...by].map(([k, v]) => [k, songStats(v)]));
}

// ---------- fetching ----------
function serverTuning() {
  if (filters.tunings.length !== 1) return null;
  const t = TUNING_CHOICES.find(([n]) => n === filters.tunings[0]);
  return t ? t[1] : null;
}

async function fetchRound() {
  const tuning = serverTuning();
  for (const c of cursors) {
    if (c.done) continue;
    const page = await searchSongs({ pattern: c.pattern, tuning, from: c.from, size: PAGE });
    c.from += page.length;
    if (page.length < PAGE) c.done = true;
    for (const s of page) if (!songs.has(s.songId)) songs.set(s.songId, s);
  }
}

async function run({ fresh = true } = {}) {
  if (busy) return;
  busy = true;
  save();
  if (fresh) {
    const patterns = query.split(';').map((p) => p.trim()).filter(Boolean).slice(0, MAX_PATTERNS);
    cursors = (patterns.length ? patterns : ['']).map((pattern) => ({ pattern, from: 0, done: false }));
    songs = new Map();
    $('list').replaceChildren(h('div', { class: 'loading' }, 'Searching Songsterr…'));
  }
  $('more').disabled = true;
  try {
    // Keep searching (a few pages) until enough songs pass the filters.
    for (let round = 0; round < 3; round++) {
      await fetchRound();
      if (rows().length >= 30 || cursors.every((c) => c.done)) break;
    }
    $('msg').hidden = true;
  } catch (err) {
    $('msg').hidden = false;
    $('msg').textContent = `Could not search Songsterr: ${err.message}. Check your internet connection and try again.`;
  }
  busy = false;
  $('more').disabled = false;
  render();
}

// After a filter change: if only a few tabs are left, search further pages by itself.
function refilter() {
  save();
  render();
  if (!busy && rows().length < 30 && cursors.some((c) => !c.done)) run({ fresh: false });
}

function rows() {
  return sortResults(filterResults(bassResults([...songs.values()]), filters, library), sortBy);
}

// ---------- results ----------
function cover(r) {
  const c = coverOf(r.title, r.artist);
  return h('div', { class: 'cover', style: { width: '40px', height: '40px', fontSize: '15px', background: `linear-gradient(${c.angle}deg, hsl(${c.hue1} 62% 42%), hsl(${c.hue2} 70% 22%))` } }, c.initials);
}

function tuningChip(r) {
  const cls = r.strings >= 5 ? 'five' : /Drop/.test(r.tuning) ? 'drop' : r.tuning === 'E Standard' ? '' : 'down';
  return h('span', { class: `tun ${cls}`, title: `${r.strings} strings` }, r.tuning);
}

function diffMeter(d) {
  if (d === null) return h('span', { class: 'small' }, 'unrated');
  return h('div', { class: `diff d${d}`, title: `Difficulty ${d} of 7 (Songsterr)` }, ...[1, 2, 3, 4, 5, 6].map((i) => h('i', { style: { height: `${5 + i * 2}px` } })), h('span', {}, String(d)));
}

function libLine(r) {
  const e = library.get(r.key);
  const st = stats.get(r.key);
  if (!e && !st) return null;
  const status = e ? (STATUSES.find(([k]) => k === e.status) || ['', ''])[1] : '';
  return h('span', { class: 'lib' }, [e && e.favorite ? '★' : '', status && e.status !== 'new' ? status : 'In your library', st && st.passes ? `best ${pct(st.bestFull ?? st.best)}` : ''].filter(Boolean).join(' · '));
}

async function patchEntry(r, fields) {
  const e = await idbLibrary.patch(r.key, {
    title: r.title, artist: r.artist, track: r.trackName.join(' | '), kind: 'songsterr', url: r.url, tuning: r.tuning,
    strings: r.strings, difficulty: r.difficulty, views: r.views, ...fields,
  });
  library.set(r.key, e);
  render();
}

function open(r) {
  setPending({ songKey: r.key, switchPart: r.partId });
  if (library.has(r.key)) patchEntry(r, {});
  window.open(r.url, '_blank', 'noopener');
}

function render() {
  const list = rows();
  const scanned = bassResults([...songs.values()]).length;
  $('count').textContent = songs.size ? `${list.length} bass tab${list.length === 1 ? '' : 's'} shown · ${songs.size} songs searched${note ? ` · ${note}` : ''}` : '';
  $('list').replaceChildren(...list.slice(0, 300).map((r, i) => {
    const e = library.get(r.key);
    const want = e && e.status === 'want';
    return h('div', { class: 'srow', style: { '--i': String(Math.min(i, 25)) } },
      cover(r),
      h('div', { class: 't' }, h('b', {}, r.title), h('span', { class: 'sub' }, r.artist), libLine(r)),
      h('div', { class: 'track', title: r.trackName.join(' · ') }, r.trackName.slice(0, 2).join(' · ') || r.instrument, h('br'), h('span', { class: 'style' }, r.instrument)),
      tuningChip(r),
      diffMeter(r.difficulty),
      h('div', { class: 'views', title: 'Views of this bass tab on Songsterr' }, fmtViews(r.views)),
      h('div', { class: 'acts' },
        h('button', { class: `btn small${e && e.favorite ? ' on' : ''}`, title: 'Favourite', onclick: () => patchEntry(r, { favorite: !(e && e.favorite) }) }, e && e.favorite ? '★' : '☆'),
        h('button', { class: `btn small${want ? ' on' : ''}`, title: 'Add to your library as "Want to learn"', onclick: () => patchEntry(r, { status: want ? 'new' : 'want' }) }, want ? '✓ Want' : '+ Want'),
        h('button', { class: 'btn small primary', title: 'Open the bass tab on Songsterr', onclick: () => open(r) }, 'Open')));
  }));
  const anyMore = cursors.some((c) => !c.done);
  $('more').hidden = !songs.size || !anyMore;
  if (songs.size && !list.length) {
    $('msg').hidden = false;
    $('msg').textContent = `No bass tabs match your filters among ${scanned} found. Loosen a filter or press "Search further".`;
  }
}

// ---------- filters ----------
function chipGroup(values, key, labelOf = (v) => v) {
  return h('div', { class: 'chips' }, ...values.map((v) => h('button', {
    class: `chip${filters[key].includes(v) ? ' on' : ''}`,
    onclick: () => {
      const on = filters[key].includes(v);
      filters[key] = on ? filters[key].filter((x) => x !== v) : [...filters[key], v];
      const tuningChanged = key === 'tunings';
      renderFilters();
      if (tuningChanged) run(); else refilter();
    },
  }, labelOf(v))));
}

function check(key, label, title = '') {
  return h('label', { class: 'chk', title }, h('input', { type: 'checkbox', checked: filters[key], onchange: (e) => { filters[key] = e.target.checked; refilter(); } }), label);
}

function select(key, options, cast = Number) {
  return h('select', { onchange: (e) => { filters[key] = cast(e.target.value); refilter(); } },
    options.map(([v, l]) => h('option', { value: v, selected: filters[key] === v }, l)));
}

function renderFilters() {
  const diffs = [1, 2, 3, 4, 5, 6, 7].map((d) => [d, String(d)]);
  $('filters').replaceChildren(
    h('h3', {}, 'Tuning'),
    chipGroup([...TUNING_CHOICES.map(([n]) => n), 'Other'], 'tunings', (n) => n.replace(' (5-string)', ' · 5')),
    h('div', { class: 'small', style: { marginTop: '4px' } }, 'One tuning: Songsterr searches it directly. Several: they are combined here.'),
    h('h3', {}, 'Strings'),
    chipGroup([4, 5, 6], 'strings', (n) => `${n}-string`),
    h('h3', {}, 'Difficulty (Songsterr, 1–7)'),
    h('div', { class: 'range' }, select('diffMin', diffs), h('span', { class: 'small' }, 'to'), select('diffMax', diffs)),
    check('includeUnrated', 'Include unrated tabs'),
    h('h3', {}, 'Popularity'),
    select('minViews', [[0, 'Any'], [1000, '1k+ views'], [10000, '10k+ views'], [100000, '100k+ views'], [1000000, '1M+ views']]),
    h('h3', {}, 'Playing style'),
    chipGroup(PLAY_STYLES.map(([k]) => k), 'styles', (k) => PLAY_STYLES.find(([x]) => x === k)[1]),
    h('h3', {}, 'Tab quality'),
    check('mainOnly', 'Main bass track only', 'The song\'s most-used bass tab; hides alternative bass parts'),
    check('hideJunk', 'Hide low-quality tabs', 'Tabs Songsterr marks as junk'),
    check('playableOnly', 'Only tabs with the player'),
    h('h3', {}, 'My library'),
    select('library', [['any', 'Any song'], ['new', 'Not in my library yet'], ['notMastered', 'Not mastered'], ['inLibrary', 'In my library'], ['favorites', 'My favourites']], String),
    h('h3', {}, 'Leave out artists'),
    h('input', { type: 'text', placeholder: 'e.g. Metallica, Muse', value: filters.excludeArtists, oninput: (e) => { filters.excludeArtists = e.target.value; save(); render(); } }),
    h('button', { class: 'btn small reset', onclick: () => { filters = { ...DEFAULT_FILTERS }; renderFilters(); run(); } }, 'Reset filters'),
  );
}

// ---------- quick searches ----------
async function quick(kind) {
  note = '';
  if (kind === 'popular') { query = ''; filters = { ...DEFAULT_FILTERS }; sortBy = 'views'; }
  if (kind === 'easy') { query = ''; filters = { ...DEFAULT_FILTERS, diffMax: 2, includeUnrated: false, minViews: 10000 }; sortBy = 'views'; }
  if (kind === 'drop') { query = ''; filters = { ...DEFAULT_FILTERS, tunings: ['Drop D'] }; sortBy = 'views'; }
  if (kind === 'five') { query = ''; filters = { ...DEFAULT_FILTERS, tunings: ['B Standard (5-string)'] }; sortBy = 'views'; }
  if (kind === 'artists') {
    const count = new Map();
    for (const e of library.values()) {
      if (e.kind !== 'songsterr' || !e.artist) continue;
      const st = stats.get(e.songKey);
      count.set(e.artist, (count.get(e.artist) || 0) + 1 + (st ? st.passes : 0) + (e.favorite ? 5 : 0));
    }
    const artists = [...count].sort((a, b) => b[1] - a[1]).slice(0, MAX_PATTERNS).map(([a]) => a);
    if (!artists.length) { note = 'no artists in your library yet'; query = ''; } else query = artists.join('; ');
    filters = { ...DEFAULT_FILTERS, library: 'new' };
    sortBy = 'views';
  }
  if (kind === 'level') {
    const lvl = await myLevel();
    filters = { ...DEFAULT_FILTERS, diffMin: Math.max(1, lvl.level - 1), diffMax: Math.min(7, lvl.level + 1), includeUnrated: false, library: 'new' };
    query = '';
    sortBy = 'views';
    note = lvl.from ? `your level ≈ ${lvl.level} (from ${lvl.from} song${lvl.from === 1 ? '' : 's'} you play at 90%+)` : `level ${lvl.level} assumed: play some songs to 90% and it adapts`;
  }
  $('q').value = query;
  $('sort').value = sortBy;
  renderFilters();
  run();
}

// Difficulty of the songs you play well; looks up unknown ones (a few searches).
async function myLevel() {
  const good = [...library.values()].filter((e) => e.kind === 'songsterr' && (stats.get(e.songKey)?.bestFull ?? 0) >= 0.9);
  for (const e of good.filter((x) => !x.difficulty).slice(0, 6)) {
    try {
      const [, songId, partId] = e.songKey.split(':').map(Number);
      const found = (await searchSongs({ pattern: `${e.artist} ${e.title}`, size: 10 })).find((s) => s.songId === songId);
      const t = found && found.tracks[partId];
      if (t && t.difficulty) library.set(e.songKey, await idbLibrary.patch(e.songKey, { difficulty: t.difficulty }));
    } catch { /* skip */ }
  }
  const withStats = [...library.values()].map((e) => ({ ...e, stats: stats.get(e.songKey) }));
  const level = levelFrom(withStats);
  return { level: level || 3, from: withStats.filter((e) => e.difficulty && (e.stats?.bestFull ?? 0) >= 0.9).length };
}

// ---------- wiring ----------
$('searchForm').addEventListener('submit', (e) => { e.preventDefault(); query = $('q').value; note = ''; run(); });
$('sort').addEventListener('change', (e) => { sortBy = e.target.value; save(); render(); });
$('more').addEventListener('click', () => run({ fresh: false }));
for (const b of document.querySelectorAll('[data-quick]')) b.addEventListener('click', () => quick(b.dataset.quick));
document.addEventListener('visibilitychange', async () => { if (document.visibilityState === 'visible') { await loadLibrary(); render(); } });

$('q').value = query;
$('sort').value = sortBy;
renderFilters();
await loadLibrary();
run();
