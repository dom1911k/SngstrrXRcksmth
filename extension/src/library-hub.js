// Library start page ("hub"): setup check, quick-start tiles, the Want-to-learn
// shelf, setlists, and the song views (list / grid / board, grouping).
import { h } from './ui/dom.js';
import { loadSettings } from './core/settings.js';
import { STATUSES } from './core/library.js';
import { loadSetlists, saveSetlists, createSetlist, toggleSong, moveSong, renameSetlist, deleteSetlist, startRunState, setRun } from './core/setlists.js';
import { accuracyColor } from './ui/progress-ui.js';

const pct = (x) => (x === null || x === undefined ? '–' : `${Math.round(x * 100)}%`);
const DAY = 86400000;

// ---------- setup check ----------
// Shown only when something needs attention; each item has a one-click fix.
export async function renderSetupCheck(el) {
  const s = await loadSettings();
  const items = [];
  if (!s.deviceLabel) items.push(['🎛', 'Choose your Real Tone Cable as the input once (panel → Input).', 'Set up input', '../player/player.html#input']);
  else if (!/rocksmith|real ?tone/i.test(s.deviceLabel)) items.push(['🎛', `The input is "${s.deviceLabel}", not the Real Tone Cable. Fine if that's on purpose.`, 'Check input', '../player/player.html#input']);
  if (s.calibrationMs === null || s.calibrationMs === undefined) items.push(['⏱', 'Calibrate the latency once so your timing is judged correctly.', 'Calibrate', '../player/player.html#calibrate']);
  else if (s.calibratedAt && Date.now() - s.calibratedAt > 30 * DAY) items.push(['⏱', `The latency calibration is ${Math.floor((Date.now() - s.calibratedAt) / DAY)} days old. Recalibrate if you changed headphones or settings.`, 'Recalibrate', '../player/player.html#calibrate']);
  try {
    const u = typeof chrome !== 'undefined' && chrome.runtime ? await chrome.runtime.sendMessage({ type: 'checkUpdate' }) : null;
    if (u && u.available) items.push(['⬆', `Version ${u.latest} is available (you have ${u.current}).`, 'Update now', '../updater/updater.html']);
  } catch { /* offline */ }
  let dismissed = [];
  try { dismissed = JSON.parse(sessionStorage.getItem('btSetupDismissed') || '[]'); } catch { /* ignore */ }
  const shown = items.filter((i) => !dismissed.includes(i[1]));
  el.hidden = !shown.length;
  el.replaceChildren(...shown.map(([icon, text, label, href]) => h('div', { class: 'setup-item' },
    h('span', { class: 'ico' }, icon), h('span', { class: 'txt' }, text),
    h('a', { class: 'btn small primary', href }, label),
    h('button', { class: 'x', title: 'Hide for now', onclick: () => {
      try { sessionStorage.setItem('btSetupDismissed', JSON.stringify([...dismissed, text])); } catch { /* ignore */ }
      renderSetupCheck(el);
    } }, '×'))));
  return { settings: s };
}

// ---------- quick-start tiles ----------
export function renderTiles(el, { entries, settings, openSong, setFilter, lesson = null }) {
  const songs = entries.filter((e) => e.kind !== 'drill');
  const last = [...songs].sort((a, b) => Math.max(b.stats.lastAt || 0, b.lastOpenedAt || 0) - Math.max(a.stats.lastAt || 0, a.lastOpenedAt || 0))[0];
  const drills = entries.filter((e) => e.kind === 'drill' && e.drillId !== 'fretboard' && e.stats.passes);
  const bestDrill = drills.sort((a, b) => (b.stats.lastAt || 0) - (a.stats.lastAt || 0))[0];
  const fret = entries.find((e) => e.songKey === 'drill:fretboard');
  const due = entries.filter((e) => e.due && e.due.due).length;
  const want = entries.filter((e) => e.status === 'want').length;
  const tile = (icon, title, sub, action, cls = '') => h(action.href ? 'a' : 'button', { class: `tile ${cls}`, href: action.href, onclick: action.onclick },
    h('span', { class: 'ico' }, icon), h('b', {}, title), h('span', { class: 'sub' }, sub));
  el.replaceChildren(...[
    // (The "Now practising" card above already has Continue for the last song.)
    last ? null : tile('▶', 'Start playing', 'Open a bass tab on Songsterr', { href: 'https://www.songsterr.com' }, 'hot'),
    tile('📅', 'Due today', due ? `${due} song${due === 1 ? '' : 's'} to revisit` : 'nothing due, nice', { onclick: () => setFilter('due') }),
    tile('🔍', 'Find songs', want ? `${want} on your Want-to-learn list` : 'search bass tabs with filters', { href: '../search/search.html' }),
    tile('🎓', 'Lessons', lesson ? `${lesson.done ? 'all done! ' : ''}${lesson.text}` : 'step-by-step technique', { href: lesson && lesson.href ? lesson.href : '../player/player.html#lessons' }),
    tile('🥁', 'Drills', bestDrill ? `${bestDrill.title.replace(/^Drill: /, '')}${bestDrill.stats.bestBpm ? ` · ${bestDrill.stats.bestBpm} BPM` : ''}` : 'warm-up & technique', { href: '../player/player.html#drills' }),
    tile('🎯', 'Fretboard trainer', fret && fret.stats.passes ? `last round ${pct(fret.stats.last)}` : 'learn the notes on the neck', { href: '../player/player.html?drill=fretboard' }),
  ].filter(Boolean));
}

// ---------- Want-to-learn shelf ----------
export function renderWantShelf(box, el, { entries, cover, openSong, patch }) {
  const want = entries.filter((e) => e.status === 'want').sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
  box.hidden = !want.length;
  el.replaceChildren(...want.map((e) => h('div', { class: 'shelf-card', title: 'Start learning: opens the song and moves it to Learning' , onclick: async () => { await patch(e, { status: 'learning' }); openSong(e); } },
    cover(e, 116),
    h('b', {}, e.title), h('span', { class: 'small' }, e.artist),
    h('div', { class: 'shelf-meta' }, e.tuning ? h('span', { class: 'tun' }, e.tuning) : null, e.difficulty ? h('span', { class: 'small' }, `difficulty ${e.difficulty}`) : null))));
}

// ---------- setlists ----------
let setlists = [];
let editing = null;

export async function loadAllSetlists() { setlists = await loadSetlists(); return setlists; }
export function getSetlists() { return setlists; }

async function store(next, rerender) { setlists = await saveSetlists(next); rerender(); }

export function renderSetlists(el, { entries, cover, openSong, rerender }) {
  const byKey = new Map(entries.map((e) => [e.songKey, e]));
  const card = (sl) => {
    const songs = sl.songKeys.map((k) => byKey.get(k)).filter(Boolean);
    const mins = Math.round(songs.reduce((a, e) => a + (e.duration || 240), 0) / 60);
    const avgBest = songs.filter((e) => e.stats.bestFull !== null).map((e) => e.stats.bestFull);
    const open = editing === sl.id;
    return h('div', { class: `setlist-card${open ? ' open' : ''}` },
      h('div', { class: 'sl-head' },
        h('div', { class: 'sl-covers' }, ...songs.slice(0, 4).map((e) => cover(e, 34))),
        h('div', { class: 'sl-title' }, h('b', {}, sl.name), h('span', { class: 'small' }, `${songs.length} song${songs.length === 1 ? '' : 's'} · ~${mins} min${avgBest.length ? ` · best avg ${pct(avgBest.reduce((a, x) => a + x, 0) / avgBest.length)}` : ''}`)),
        h('div', { class: 'sl-acts' },
          h('button', { class: 'btn small primary', disabled: !songs.length, title: 'Play the songs in order, with a running score', onclick: async () => {
            await setRun(startRunState({ ...sl, songKeys: songs.map((e) => e.songKey) }));
            openSong(songs[0]);
          } }, '▶ Play'),
          h('button', { class: 'btn small', onclick: () => { editing = open ? null : sl.id; rerender(); } }, open ? 'Done' : 'Edit'))),
      open ? h('div', { class: 'sl-edit' },
        h('div', { class: 'bar-row' },
          h('input', { type: 'text', value: sl.name, class: 'sl-name', onchange: (ev) => store(renameSetlist(setlists, sl.id, ev.target.value), rerender) }),
          h('button', { class: 'btn small', onclick: async (ev) => {
            if (ev.target.dataset.c !== '1') { ev.target.dataset.c = '1'; ev.target.textContent = 'Click again to delete'; return; }
            editing = null;
            await store(deleteSetlist(setlists, sl.id), rerender);
          } }, 'Delete setlist')),
        songs.length ? h('ol', { class: 'sl-songs' }, ...songs.map((e, i) => h('li', {},
          h('span', { class: 'grow' }, `${e.title}`, h('span', { class: 'small' }, ` · ${e.artist || ''}`)),
          h('button', { class: 'btn small', disabled: i === 0, title: 'Move up', onclick: () => store(moveSong(setlists, sl.id, e.songKey, -1), rerender) }, '↑'),
          h('button', { class: 'btn small', disabled: i === songs.length - 1, title: 'Move down', onclick: () => store(moveSong(setlists, sl.id, e.songKey, 1), rerender) }, '↓'),
          h('button', { class: 'btn small', title: 'Remove from this setlist', onclick: () => store(toggleSong(setlists, sl.id, e.songKey), rerender) }, '✕'))))
          : h('p', { class: 'small' }, 'Empty. Add songs from a song\'s details (click a song → Setlists).')) : null);
  };
  el.replaceChildren(...setlists.map(card),
    h('button', { class: 'setlist-card new', onclick: async () => {
      const name = prompt('Name of the new setlist:', 'Band rehearsal');
      if (name === null) return;
      const next = createSetlist(setlists, name);
      editing = next[next.length - 1].id;
      await store(next, rerender);
    } }, '+ New setlist'));
}

// Setlist chips in a song's detail panel.
export function setlistChips(e, rerender) {
  if (!setlists.length) return h('p', { class: 'small' }, 'No setlists yet: create one in "Setlists" above.');
  return h('div', { class: 'chips' }, ...setlists.map((sl) => h('button', {
    class: `chip${sl.songKeys.includes(e.songKey) ? ' on' : ''}`,
    onclick: () => store(toggleSong(setlists, sl.id, e.songKey), rerender),
  }, sl.songKeys.includes(e.songKey) ? `✓ ${sl.name}` : `+ ${sl.name}`)));
}

// ---------- song views ----------
export const VIEWS = [['list', '☰ List'], ['grid', '▦ Grid'], ['board', '▥ Board']];

export function groupKey(e, by) {
  if (by === 'tuning') return e.kind === 'drill' ? 'Drills' : e.tuning || 'Unknown tuning';
  if (by === 'artist') return e.kind === 'drill' ? 'Drills' : e.artist || 'Unknown artist';
  if (by === 'status') return e.kind === 'drill' ? 'Drills' : (STATUSES.find(([k]) => k === e.status) || STATUSES[0])[1];
  return '';
}

// Groups in a useful order: the biggest tuning group first ("no retuning"), artists A–Z, statuses in order.
export function groupEntries(list, by) {
  if (by === 'none') return [['', list]];
  const map = new Map();
  for (const e of list) { const k = groupKey(e, by); if (!map.has(k)) map.set(k, []); map.get(k).push(e); }
  const order = [...map.keys()];
  if (by === 'tuning') order.sort((a, b) => (a === 'Drills') - (b === 'Drills') || map.get(b).length - map.get(a).length || a.localeCompare(b));
  if (by === 'artist') order.sort((a, b) => (a === 'Drills') - (b === 'Drills') || a.localeCompare(b));
  if (by === 'status') { const idx = (k) => { const i = STATUSES.findIndex(([, l]) => l === k); return i < 0 ? 99 : i; }; order.sort((a, b) => idx(a) - idx(b)); }
  return order.map((k) => [k, map.get(k)]);
}

export function gridCard(e, { cover, showDetail, openSong, statusBadge }) {
  const st = e.stats;
  return h('div', { class: 'gcard', onclick: () => showDetail(e) },
    h('div', { class: 'gcover' }, cover(e, 150), e.favorite ? h('span', { class: 'gfav' }, '★') : null,
      h('button', { class: 'gplay', title: 'Open', onclick: (ev) => { ev.stopPropagation(); openSong(e); } }, '▶')),
    h('b', {}, e.title), h('span', { class: 'small' }, e.artist || ''),
    h('div', { class: 'gmeta' }, statusBadge(e), h('span', { class: 'gbest', style: { color: st.best !== null ? accuracyColor(st.bestFull ?? st.best) : '' } }, pct(st.bestFull ?? st.best))));
}

// Board: one column per status; drag a card to another column to change it.
export function renderBoard(el, list, { cover, showDetail, patch }) {
  const cols = STATUSES.map(([k, label]) => [k, label, list.filter((e) => e.kind !== 'drill' && (e.status || 'new') === k)]);
  el.replaceChildren(h('div', { class: 'board' }, ...cols.map(([k, label, items]) => {
    const col = h('div', { class: 'bcol', 'data-status': k },
      h('div', { class: 'bhead' }, label, h('span', { class: 'n' }, items.length)),
      ...items.map((e) => {
        const c = h('div', { class: 'bcard', draggable: 'true', onclick: () => showDetail(e) }, cover(e, 36), h('div', {}, h('b', {}, e.title), h('span', { class: 'small' }, e.artist || '')),
          h('span', { class: 'gbest' }, pct(e.stats.bestFull ?? e.stats.best)));
        c.addEventListener('dragstart', (ev) => { ev.dataTransfer.setData('text/plain', e.songKey); c.classList.add('dragging'); });
        c.addEventListener('dragend', () => c.classList.remove('dragging'));
        return c;
      }));
    col.addEventListener('dragover', (ev) => { ev.preventDefault(); col.classList.add('over'); });
    col.addEventListener('dragleave', () => col.classList.remove('over'));
    col.addEventListener('drop', async (ev) => {
      ev.preventDefault();
      col.classList.remove('over');
      const key = ev.dataTransfer.getData('text/plain');
      const e = list.find((x) => x.songKey === key);
      if (e && e.status !== k) await patch(e, { status: k });
    });
    return col;
  })), h('p', { class: 'small' }, 'Drag a song to another column to change its status. Drills are not shown here.'));
}
