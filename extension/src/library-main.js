// Library page (extension page library/library.html): your songs with
// favourites, status, notes and statistics from the practice history.
import { h } from './ui/dom.js';
import { idbHistory, idbLibrary, idbSessions } from './core/history-db.js';
import { aggregate } from './core/history.js';
import { STATUSES, songStats, overallStats, setPending, dueInfo, goalProgress, goalLabel, practiceByDay, coverOf } from './core/library.js';
import { drillById } from './core/drills.js';
import { accuracyColor } from './ui/progress-ui.js';

const $ = (id) => document.getElementById(id);
const pct = (x) => (x === null || x === undefined ? '–' : `${Math.round(x * 100)}%`);
function dur(sec) {
  if (!sec) return '0 min';
  if (sec < 60) return `${Math.round(sec)} s`;
  const m = Math.round(sec / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60 ? `${m % 60} min` : ''}`.trim();
}
function ago(ms) {
  if (!ms) return 'never';
  const d = (Date.now() - ms) / 86400000;
  if (d < 1 / 24) return 'just now';
  if (d < 1) return `${Math.round(d * 24)} h ago`;
  if (d < 2) return 'yesterday';
  if (d < 30) return `${Math.round(d)} days ago`;
  return new Date(ms).toLocaleDateString();
}

let entries = [];         // library entries merged with stats
let records = [];
let filter = 'all';
let selected = null;

async function load() {
  const [lib, recs, sessions] = await Promise.all([idbLibrary.all(), idbHistory.all(), idbSessions.recent(6)]);
  renderSessions(sessions);
  records = recs.sort((a, b) => a.at - b.at);
  const byKey = new Map();
  for (const r of records) {
    if (!byKey.has(r.songKey)) byKey.set(r.songKey, []);
    byKey.get(r.songKey).push(r);
  }
  const map = new Map(lib.map((e) => [e.songKey, e]));
  // Songs practised before the library existed, and drills.
  for (const [key, recs2] of byKey) {
    if (map.has(key)) continue;
    const last = recs2[recs2.length - 1];
    const drill = key.startsWith('drill:') ? drillById(key.slice(6)) : null;
    map.set(key, {
      songKey: key, title: drill ? `Drill: ${drill.name}` : last.title, artist: drill ? '' : last.artist,
      kind: drill ? 'drill' : key.startsWith('songsterr:') ? 'songsterr' : 'local', drillId: drill ? drill.id : undefined,
      favorite: false, status: 'new', notes: '', addedAt: recs2[0].at, implicit: true,
    });
  }
  entries = [...map.values()].map((e) => {
    const recs3 = byKey.get(e.songKey) || [];
    const stats = songStats(recs3);
    return { ...e, records: recs3, stats, due: dueInfo(e, stats), goalProg: goalProgress(e.goal, recs3) };
  });
  render();
}

// ---------- overview ----------
function renderOverview() {
  const o = overallStats(records);
  const card = (v, l, cls = '') => h('div', { class: 'card' }, h('div', { class: `v ${cls}` }, v), h('div', { class: 'l' }, l));
  $('overview').replaceChildren(
    card(dur(o.weekSeconds), `practised this week · ${o.weekPasses} passes`),
    card(o.weekSongs, o.weekSongs === 1 ? 'song this week' : 'songs this week'),
    card(pct(o.weekAccuracy), 'accuracy this week'),
    card(o.streak ? `${o.streak} 🔥` : '0', o.streak === 1 ? 'day in a row' : 'days in a row', 'flame'),
    card(dur(o.totalSeconds), (() => { const n = entries.filter((e) => e.kind !== 'drill').length; return `total · ${n} song${n === 1 ? '' : 's'}`; })()),
  );
  renderHeatmap();
  $('practiceNote').textContent = o.streak >= 2 ? `${o.streak} days in a row. Keep it going!` : o.weekSeconds ? '' : 'Nothing practised this week yet.';
}

// Practice heat map: the last 52 weeks, one square per day (like GitHub).
function renderHeatmap() {
  const byDay = practiceByDay(records);
  const DAY = 86400000;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const dow = (today.getDay() + 6) % 7;                     // Monday = 0
  const WEEKS = 52;
  const start = today.getTime() - ((WEEKS - 1) * 7 + dow) * DAY; // Monday 51 weeks ago
  const level = (sec) => (!sec ? 0 : sec < 10 * 60 ? 1 : sec < 20 * 60 ? 2 : sec < 40 * 60 ? 3 : 4);
  const cols = [];
  let lastMonth = -1, lastLabel = -9;
  for (let w = 0; w < WEEKS; w++) {
    const first = new Date(start + w * 7 * DAY);
    const month = first.getMonth();
    const cells = [];
    for (let d = 0; d < 7; d++) {
      const t = start + (w * 7 + d) * DAY;
      if (t > today.getTime()) { cells.push(h('i', { class: 'c future' })); continue; }
      const sec = byDay.get(t) || 0;
      cells.push(h('i', { class: `c l${level(sec)}${t === today.getTime() ? ' today' : ''}`, title: `${new Date(t).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })}: ${dur(sec)}` }));
    }
    const label = month !== lastMonth && w - lastLabel >= 3 && w < WEEKS - 1;
    if (label) lastLabel = w;
    cols.push(h('div', { class: 'wk' }, h('span', { class: 'mo' }, label ? first.toLocaleDateString([], { month: 'short' }) : ''), ...cells));
    lastMonth = month;
  }
  $('practiceChart').replaceChildren(
    h('div', { class: 'days' }, ...['Mon', '', 'Wed', '', 'Fri', '', ''].map((d) => h('span', {}, d))),
    h('div', { class: 'weeks' }, ...cols),
    h('div', { class: 'legend' }, 'less', ...[0, 1, 2, 3, 4].map((l) => h('i', { class: `c l${l}` })), 'more'));
}

// A song's cover tile (generated colours and initials).
function cover(e, size = 44) {
  const c = coverOf(e.title, e.artist);
  return h('div', { class: `cover${e.kind === 'drill' ? ' drill' : ''}`, style: {
    width: `${size}px`, height: `${size}px`, fontSize: `${Math.round(size * 0.38)}px`,
    background: `linear-gradient(${c.angle}deg, hsl(${c.hue1} 62% 42%), hsl(${c.hue2} 70% 22%))`,
  } }, e.kind === 'drill' ? '♩' : c.initials);
}

// "Now practising": the song you played most recently, with quick actions.
function renderHero() {
  const songs = entries.filter((e) => e.kind !== 'drill' && (e.stats.lastAt || e.lastOpenedAt));
  const e = songs.sort((a, b) => Math.max(b.stats.lastAt || 0, b.lastOpenedAt || 0) - Math.max(a.stats.lastAt || 0, a.lastOpenedAt || 0))[0];
  $('hero').hidden = !e;
  if (!e) return;
  const st = e.stats;
  let weakest = null;
  if (e.layout && e.records.length) {
    const agg = aggregate(e.records.filter((r) => r.barCount === e.layout.bars.length), { bars: e.layout.bars, sections: e.layout.sections });
    weakest = agg.sections.filter((x) => x.accuracy !== null).sort((a, b) => a.accuracy - b.accuracy)[0] || null;
  }
  const g = e.goal ? e.goalProg : null;
  $('hero').replaceChildren(
    cover(e, 112),
    h('div', { class: 'hero-body' },
      h('div', { class: 'kicker' }, 'NOW PRACTISING'),
      h('div', { class: 'hero-title' }, e.title),
      h('div', { class: 'small' }, [e.artist, e.track, e.tuning].filter(Boolean).join(' · ')),
      h('div', { class: 'hero-stats' },
        statusBadge(e),
        h('span', {}, h('b', {}, pct(st.bestFull ?? st.best)), ' best'),
        h('span', {}, h('b', {}, pct(st.last)), ' last'),
        h('span', {}, h('b', {}, dur(st.seconds)), ' practised'),
        st.trend !== null ? h('span', { class: st.trend >= 0 ? 'good' : 'bad' }, st.trend >= 0 ? '↑ improving' : '↓ dropping') : null),
      g ? h('div', { class: 'hero-goal' }, h('span', { class: 'small' }, `🎯 ${goalLabel(e.goal)}`),
        h('div', { class: 'meter big' }, h('i', { style: { width: `${Math.round(g.fraction * 100)}%`, background: e.goal.reachedAt ? '#5fd38d' : '#f2c418' } }))) : null,
      h('div', { class: 'bar-row' },
        h('button', { class: 'btn primary', onclick: () => openSong(e) }, '▶ Continue'),
        weakest && weakest.accuracy < 0.98 ? h('button', { class: 'btn', title: 'Open the song and loop this section', onclick: () => openSong(e, { loopBars: [weakest.firstBar, weakest.lastBar] }) }, `Practise "${weakest.name}" (${pct(weakest.accuracy)})`) : null,
        h('button', { class: 'btn', onclick: () => showDetail(e) }, 'Details'))));
}

// ---------- list ----------
const FILTERS = [['all', 'All songs'], ['due', 'Due today'], ['fav', '★ Favourites'], ...STATUSES.filter(([k]) => k !== 'new'), ['drill', 'Drills']];

function matches(e, f = filter, q = $('search').value.trim().toLowerCase()) {
  const filter = f;
  if (filter === 'fav' && !e.favorite) return false;
  if (filter === 'due' && !(e.due && e.due.due)) return false;
  if (filter === 'drill') { if (e.kind !== 'drill') return false; } else if (e.kind === 'drill' && filter !== 'all') return false;
  if (STATUSES.some(([k]) => k === filter) && e.status !== filter) return false;
  return !q || `${e.title} ${e.artist} ${e.track || ''} ${e.notes || ''}`.toLowerCase().includes(q);
}

function sorted(list) {
  const by = $('sort').value;
  const last = (e) => Math.max(e.stats.lastAt || 0, e.lastOpenedAt || 0);
  const f = {
    recent: (a, b) => last(b) - last(a),
    time: (a, b) => b.stats.seconds - a.stats.seconds,
    best: (a, b) => (b.stats.best || 0) - (a.stats.best || 0),
    added: (a, b) => (b.addedAt || 0) - (a.addedAt || 0),
    title: (a, b) => a.title.localeCompare(b.title),
  }[by];
  // Favourites first, then the chosen order.
  return [...list].sort((a, b) => (b.favorite - a.favorite) || f(a, b));
}

function sparkline(values) {
  const w = 120, hgt = 28;
  if (values.length < 2) return h('span', { class: 'small c-spark' }, values.length ? 'one pass' : 'no passes yet');
  const xs = values.map((_, i) => (i / (values.length - 1)) * (w - 4) + 2);
  const ys = values.map((v) => hgt - 3 - v * (hgt - 6));
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${hgt}`);
  svg.setAttribute('class', 'spark c-spark');
  const line = document.createElementNS(ns, 'polyline');
  line.setAttribute('points', xs.map((x, i) => `${x.toFixed(1)},${ys[i].toFixed(1)}`).join(' '));
  line.setAttribute('fill', 'none');
  line.setAttribute('stroke', '#f2c418');
  line.setAttribute('stroke-width', '1.6');
  line.setAttribute('stroke-linejoin', 'round');
  const dot = document.createElementNS(ns, 'circle');
  dot.setAttribute('cx', xs[xs.length - 1]); dot.setAttribute('cy', ys[ys.length - 1]); dot.setAttribute('r', '2.5');
  dot.setAttribute('fill', accuracyColor(values[values.length - 1]));
  svg.append(line, dot);
  return svg;
}

function statusBadge(e) {
  if (e.kind === 'drill') return h('span', { class: 'badge drill' }, 'Drill');
  const s = STATUSES.find(([k]) => k === e.status) || STATUSES[0];
  return h('span', { class: `badge ${s[0]}` }, s[1]);
}

function openSong(e, pending = null) {
  if (pending) setPending({ songKey: e.songKey, ...pending });
  if (e.kind === 'drill') {
    const next = e.stats.bestBpm ? e.stats.bestBpm + 5 : '';
    location.href = `../player/player.html?drill=${encodeURIComponent(e.drillId)}${next ? `&bpm=${next}` : ''}`;
  } else if (e.kind === 'local') {
    location.href = `../player/player.html?song=${encodeURIComponent(e.songKey)}`;
  } else {
    const m = e.songKey.match(/^songsterr:(\d+):(\d+)$/);
    const url = e.url || (m ? `https://www.songsterr.com/a/wa/song?id=${m[1]}` : 'https://www.songsterr.com');
    window.open(url, '_blank', 'noopener');
  }
}

async function setFav(e, on) {
  const patch = { favorite: on, ...(on && e.status === 'new' ? { status: 'learning' } : {}) };
  const saved = await idbLibrary.patch(e.songKey, { title: e.title, artist: e.artist, kind: e.kind, drillId: e.drillId, ...patch });
  Object.assign(e, saved, { implicit: false });
  render();
}

function render() {
  renderOverview();
  const counts = Object.fromEntries(FILTERS.map(([k]) => [k, entries.filter((e) => matches(e, k, '')).length]));
  $('filters').replaceChildren(...FILTERS.map(([k, label]) => h('button', { class: `chip${k === filter ? ' on' : ''}`, onclick: () => { filter = k; render(); } },
    label, h('span', { class: 'n' }, counts[k]))));
  renderDue();
  renderHero();
  const list = sorted(entries.filter((e) => matches(e)));
  $('list').replaceChildren(...list.map((e, i) => {
    const st = e.stats;
    const row = h('div', { class: `row${selected === e.songKey ? ' sel' : ''}`, style: { '--i': String(Math.min(i, 20)) }, onclick: () => showDetail(e) },
      cover(e, 40),
      h('button', { class: `fav${e.favorite ? ' on' : ''}`, title: e.favorite ? 'Remove from favourites' : 'Add to favourites', onclick: (ev) => { ev.stopPropagation(); setFav(e, !e.favorite); } }, e.favorite ? '★' : '☆'),
      h('div', { class: 'title' }, h('b', {}, e.title, e.due && e.due.due ? h('span', { class: 'duetag', title: e.due.reason }, 'due') : null),
        h('span', { class: 'sub' }, [e.artist, e.track, `played ${ago(st.lastAt || e.lastOpenedAt)}`].filter(Boolean).join(' · ')),
        e.goal ? h('span', { class: `goalline${e.goal.reachedAt ? ' done' : ''}` }, e.goal.reachedAt ? `🎯 Goal reached: ${goalLabel(e.goal)}` : `🎯 ${goalLabel(e.goal)} · best so far ${pct(e.goalProg.best)}`) : null),
      h('div', { class: 'c-status' }, statusBadge(e)),
      h('div', { class: 'small c-tuning' }, e.kind === 'drill' ? (st.bestBpm ? `90%+ at ${st.bestBpm} BPM` : '') : e.tuning || ''),
      h('div', { class: 'num small c-time', title: `${st.passes} passes` }, dur(st.seconds)),
      h('div', { class: 'num c-best', title: 'Best pass (at 100% speed)' }, h('b', { style: { color: st.best !== null ? accuracyColor(st.bestFull ?? st.best) : '' } }, pct(st.bestFull ?? st.best)),
        h('span', { class: 'small' }, st.bestFull === null && st.best !== null ? ' (slowed)' : st.trend !== null ? ` ${st.trend > 0.01 ? '↑' : st.trend < -0.01 ? '↓' : '→'}` : '')),
      sparkline(st.recent),
      h('div', { class: 'actions' }, h('button', { class: 'btn small primary', onclick: (ev) => { ev.stopPropagation(); openSong(e); } }, e.kind === 'drill' ? 'Play' : 'Open')));
    return row;
  }));
  $('empty').hidden = list.length > 0;
  $('empty').textContent = entries.length
    ? 'No songs match.'
    : 'No songs yet. Open a bass track on Songsterr (or a chart in the player) and it appears here. Press ☆ Save on the highway to make it a favourite.';
}

// Recent sessions (session reports saved when you stopped the input).
function renderSessions(list) {
  $('sessionsBox').hidden = !list.length;
  $('sessions').replaceChildren(...list.map((r) => h('div', { class: 'sess' },
    h('div', { class: 'when' }, new Date(r.start).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }),
      h('span', { class: 'small' }, ` ${new Date(r.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`)),
    h('div', { class: 'small' }, `${dur(r.wallSeconds)} · ${r.passes} pass${r.passes === 1 ? '' : 'es'} · ${pct(r.accuracy)}`),
    h('div', { class: 'songs' }, r.songs.map((x) => x.title).join(', ')),
    r.highlights.length ? h('div', { class: 'hl' }, `★ ${r.highlights[0]}`) : null)));
}

// "Due today": the songs to revisit now, most overdue first.
function renderDue() {
  const due = entries.filter((e) => e.due && e.due.due).sort((a, b) => b.due.overdueDays - a.due.overdueDays).slice(0, 6);
  $('dueBox').hidden = !due.length;
  $('dueList').replaceChildren(...due.map((e) => h('div', { class: 'duecard', onclick: () => showDetail(e) },
    h('div', { class: 'duetop' }, cover(e, 38), h('div', {}, h('b', {}, e.title), h('span', { class: 'small' }, e.artist))),
    h('span', { class: 'why' }, e.due.reason),
    h('button', { class: 'btn small primary', onclick: (ev) => { ev.stopPropagation(); openSong(e); } }, 'Practise'))));
  const nDue = entries.filter((e) => e.due && e.due.due).length;
  $('dueNote').textContent = nDue ? `${nDue} song${nDue === 1 ? '' : 's'} to revisit so you don't lose ${nDue === 1 ? 'it' : 'them'}` : '';
}

// Goal editor in the detail panel.
function goalEditor(e) {
  const acc = h('select', {}, [0.8, 0.85, 0.9, 0.95, 1].map((v) => h('option', { value: v, selected: (e.goal ? e.goal.accuracy : 0.9) === v }, `${Math.round(v * 100)}%`)));
  const spd = h('select', {}, [0.7, 0.8, 0.9, 1].map((v) => h('option', { value: v, selected: (e.goal ? e.goal.speed : 1) === v }, `${Math.round(v * 100)}% speed`)));
  const by = h('input', { type: 'date', value: e.goal && e.goal.by ? new Date(e.goal.by).toISOString().slice(0, 10) : '' });
  const save = async (goal) => { Object.assign(e, await idbLibrary.patch(e.songKey, { title: e.title, artist: e.artist, kind: e.kind, goal })); await load(); showDetail(entries.find((x) => x.songKey === e.songKey)); };
  const g = e.goalProg;
  return h('div', { class: 'goalbox' },
    e.goal ? h('div', {},
      h('div', { class: 'goalhead' }, h('b', {}, goalLabel(e.goal)),
        e.goal.reachedAt ? h('span', { class: 'good' }, ` reached ${new Date(e.goal.reachedAt).toLocaleDateString()} 🎉`)
          : g.daysLeft !== null ? h('span', { class: g.overdue ? 'bad' : 'small' }, g.overdue ? ' · date passed' : ` · ${g.daysLeft} day${g.daysLeft === 1 ? '' : 's'} left`) : null),
      h('div', { class: 'meter big' }, h('i', { style: { width: `${Math.round(g.fraction * 100)}%`, background: e.goal.reachedAt ? '#5fd38d' : '#f2c418' } })),
      h('div', { class: 'small' }, `Best so far at ${Math.round(e.goal.speed * 100)}% speed (since the goal was set): ${pct(g.best)}. When you reach it, the song is marked Mastered.`)) : h('div', { class: 'small' }, 'Set a goal for this song. When you reach it, it is marked Mastered.'),
    h('div', { class: 'bar-row' }, acc, spd, h('label', { class: 'small' }, 'by ', by),
      h('button', { class: 'btn small primary', onclick: () => save({ accuracy: Number(acc.value), speed: Number(spd.value), by: by.value ? new Date(`${by.value}T23:59:00`).getTime() : null, setAt: e.goal && !e.goal.reachedAt ? e.goal.setAt : Date.now() }) }, e.goal ? 'Update goal' : 'Set goal'),
      e.goal ? h('button', { class: 'btn small', onclick: () => save(null) }, 'Remove') : null));
}

// ---------- detail ----------
function historyChart(recs) {
  const last = recs.slice(-40);
  const w = 480, hgt = 110;
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${hgt}`);
  svg.setAttribute('class', 'histchart');
  for (const g of [0.5, 0.75, 0.9]) {
    const y = hgt - 8 - g * (hgt - 16);
    const l = document.createElementNS(ns, 'line');
    l.setAttribute('x1', 30); l.setAttribute('x2', w - 6); l.setAttribute('y1', y); l.setAttribute('y2', y);
    l.setAttribute('stroke', '#2a2e36'); l.setAttribute('stroke-dasharray', '3 3');
    const t = document.createElementNS(ns, 'text');
    t.setAttribute('x', 4); t.setAttribute('y', y + 4); t.setAttribute('fill', '#6f7685'); t.setAttribute('font-size', '10');
    t.textContent = `${g * 100}%`;
    svg.append(l, t);
  }
  const bw = (w - 40) / Math.max(1, last.length);
  last.forEach((r, i) => {
    const v = r.accuracy || 0;
    const rect = document.createElementNS(ns, 'rect');
    const bh = Math.max(2, v * (hgt - 16));
    rect.setAttribute('x', 32 + i * bw + 1); rect.setAttribute('width', Math.max(2, bw - 2));
    rect.setAttribute('y', hgt - 8 - bh); rect.setAttribute('height', bh); rect.setAttribute('rx', 2);
    rect.setAttribute('fill', accuracyColor(v));
    rect.setAttribute('opacity', (r.speed || 1) < 0.999 ? '0.55' : '1');
    const tip = document.createElementNS(ns, 'title');
    tip.textContent = `${new Date(r.at).toLocaleString()}: ${pct(v)} (${r.kind}${(r.speed || 1) < 0.999 ? `, ${Math.round(r.speed * 100)}% speed` : ''}${r.bpm ? `, ${r.bpm} BPM` : ''})`;
    rect.append(tip);
    svg.append(rect);
  });
  return svg;
}

function showDetail(e) {
  selected = e.songKey;
  const st = e.stats;
  const layout = e.layout || null;
  const agg = layout ? aggregate(e.records.filter((r) => r.barCount === layout.bars.length), { bars: layout.bars, sections: layout.sections }) : null;
  const notes = h('textarea', { placeholder: 'Notes: fingering, tricky bars, tone settings…' }, e.notes || '');
  let saveTimer = null;
  notes.addEventListener('input', () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => { Object.assign(e, await idbLibrary.patch(e.songKey, { title: e.title, artist: e.artist, kind: e.kind, notes: notes.value })); }, 400);
  });
  const status = h('select', { onchange: async (ev) => { Object.assign(e, await idbLibrary.patch(e.songKey, { title: e.title, artist: e.artist, kind: e.kind, status: ev.target.value })); render(); } },
    STATUSES.map(([k, l]) => h('option', { value: k, selected: e.status === k }, l)));
  const practise = (first, last, label = 'Practise') => h('button', { class: 'btn small', title: 'Open the song and loop these bars', onclick: () => openSong(e, { loopBars: [first, last] }) }, label);
  const canLoop = e.kind !== 'drill';
  $('detail').replaceChildren(...[
    h('button', { class: 'btn small close', onclick: () => { $('detail').hidden = true; selected = null; render(); } }, 'Close'),
    h('div', { class: 'dhead' }, cover(e, 64), h('div', {}, h('h3', {}, e.title),
    h('div', { class: 'small' }, [e.artist, e.track, e.tuning, e.kind === 'songsterr' ? 'Songsterr' : e.kind === 'local' ? 'own chart' : 'drill'].filter(Boolean).join(' · ')))),
    h('div', { class: 'bar-row' },
      h('button', { class: 'btn primary', onclick: () => openSong(e) }, e.kind === 'drill' ? `Play${st.bestBpm ? ` at ${st.bestBpm + 5} BPM` : ''}` : 'Open song'),
      h('button', { class: 'btn', onclick: () => setFav(e, !e.favorite).then(() => showDetail(e)) }, e.favorite ? '★ Favourite' : '☆ Add to favourites'),
      e.kind !== 'drill' ? h('label', { class: 'small' }, 'Status ', status) : null),
    h('div', { class: 'grid' },
      h('div', {}, h('b', {}, st.passes), h('span', { class: 'small' }, 'passes')),
      h('div', {}, h('b', {}, dur(st.seconds)), h('span', { class: 'small' }, 'practised')),
      h('div', {}, h('b', {}, st.days), h('span', { class: 'small' }, 'days')),
      h('div', {}, h('b', {}, pct(st.bestFull)), h('span', { class: 'small' }, 'best at 100%')),
      h('div', {}, h('b', {}, pct(st.best)), h('span', { class: 'small' }, 'best overall')),
      h('div', {}, h('b', {}, e.kind === 'drill' ? (st.bestBpm ? `${st.bestBpm}` : '–') : st.bestSpeed ? `${Math.round(st.bestSpeed * 100)}%` : '–'),
        h('span', { class: 'small' }, e.kind === 'drill' ? 'best BPM (90%+)' : 'fastest at 90%+'))),
    e.kind !== 'drill' ? h('h4', {}, 'Goal') : null,
    e.kind !== 'drill' ? goalEditor(e) : null,
    e.due ? h('div', { class: 'small', style: { marginTop: '8px' } }, e.due.due ? `Due for practice: ${e.due.reason}.` : `Next review in ${Math.max(1, Math.ceil((e.due.dueAt - Date.now()) / 86400000))} day(s) (every ~${Math.round(e.due.days)} days at this level).`) : null,
    st.passes ? h('h4', {}, `Last ${Math.min(40, st.passes)} passes`) : null,
    st.passes ? historyChart(e.records) : h('p', { class: 'small' }, 'No scored passes yet. Start the input and play the song.'),
    st.passes ? h('div', { class: 'small' }, `First practised ${new Date(st.firstAt).toLocaleDateString()} · last ${ago(st.lastAt)}${st.trend !== null ? ` · trend ${st.trend >= 0 ? '+' : ''}${Math.round(st.trend * 100)} points over the last 5 passes` : ''}. Faded bars were played slowed down.`) : null,
    agg && agg.sections.length > 1 ? h('h4', {}, 'Sections') : null,
    ...(agg && agg.sections.length > 1 ? agg.sections.map((s) => h('div', { class: 'sec' },
      h('span', {}, s.name, h('span', { class: 'small' }, ` bars ${layout.bars[s.firstBar].measure + 1}–${layout.bars[s.lastBar].measure + 1}`)),
      h('div', { class: 'meter' }, h('i', { style: { width: `${Math.round((s.accuracy || 0) * 100)}%`, background: accuracyColor(s.accuracy) } })),
      h('span', { class: 'num' }, pct(s.accuracy)),
      canLoop ? practise(s.firstBar, s.lastBar) : null)) : []),
    agg && agg.weakBars.length ? h('h4', {}, 'Weak spots') : null,
    agg && agg.weakBars.length ? h('table', {}, ...agg.weakBars.map((b) => h('tr', {},
      h('td', {}, `Bar ${b.number}`, b.section ? h('span', { class: 'small' }, ` · ${b.section}`) : null),
      h('td', { class: 'r' }, `${Math.round(b.missRate * 100)}% missed`),
      h('td', { class: 'r' }, canLoop ? practise(Math.max(0, b.bar - 1), Math.min(layout.bars.length - 1, b.bar + 1)) : null)))) : null,
    h('h4', {}, 'Notes'),
    notes,
    h('div', { class: 'bar-row' },
      h('button', { class: 'btn small', onclick: async (ev) => {
        if (ev.target.dataset.c !== '1') { ev.target.dataset.c = '1'; ev.target.textContent = 'Click again: removes the song and its history'; return; }
        await idbLibrary.remove(e.songKey);
        await idbHistory.clear(e.songKey);
        $('detail').hidden = true;
        selected = null;
        await load();
      } }, 'Remove from library')),
  ].filter(Boolean));
  $('detail').hidden = false;
  render();
}

$('search').addEventListener('input', render);
$('sort').addEventListener('change', render);
window.addEventListener('keydown', (e) => { if (e.key === 'Escape') { $('detail').hidden = true; selected = null; render(); } });
// Refresh when you come back from practising.
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') load(); });
load();
