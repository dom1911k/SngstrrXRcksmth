// Song search on Songsterr's own search (the one its website uses), with
// bass-specific filters on top. Only public song data is read: titles,
// artists, tracks with instrument, tuning, difficulty and views.
//
//   searchSongs({ pattern, tuning, from, size }) -> Songsterr songs
//   bassResults(songs) -> one row per bass track
//   filterResults(rows, filters, library) / sortResults(rows, by)

import { TUNINGS, noteName } from './music.js';

const API = 'https://www.songsterr.com/api/songs';

// General MIDI programs of bass instruments (0-based): acoustic, finger, pick,
// fretless, slap 1/2, synth 1/2; contrabass (43) only with a bass range.
const BASS_PROGRAMS = new Set([32, 33, 34, 35, 36, 37, 38, 39]);

export const TUNING_CHOICES = [
  ['E Standard', [28, 33, 38, 43]],
  ['Drop D', [26, 33, 38, 43]],
  ['Eb Standard', [27, 32, 37, 42]],
  ['Drop C#', [25, 32, 37, 42]],
  ['D Standard', [26, 31, 36, 41]],
  ['Drop C', [24, 31, 36, 41]],
  ['C Standard', [24, 29, 34, 39]],
  ['B Standard (5-string)', [23, 28, 33, 38, 43]],
];

export const PLAY_STYLES = [['finger', 'Finger'], ['pick', 'Pick'], ['fretless', 'Fretless'], ['slap', 'Slap'], ['synth', 'Synth bass'], ['acoustic', 'Acoustic'], ['contrabass', 'Contrabass']];

export function playStyleOf(instrument = '') {
  const s = instrument.toLowerCase();
  if (s.includes('finger')) return 'finger';
  if (s.includes('pick')) return 'pick';
  if (s.includes('fretless')) return 'fretless';
  if (s.includes('slap')) return 'slap';
  if (s.includes('synth')) return 'synth';
  if (s.includes('acoustic')) return 'acoustic';
  if (s.includes('contrabass')) return 'contrabass';
  return 'other';
}

// Low-first tuning (Songsterr lists high first) and a readable name.
export function tuningInfo(tuningHighFirst) {
  const low = [...(tuningHighFirst || [])].reverse();
  for (const [name, t] of Object.entries(TUNINGS)) if (t.length === low.length && t.every((v, i) => v === low[i])) return { low, name };
  for (const [name, t] of TUNING_CHOICES) if (t.length === low.length && t.every((v, i) => v === low[i])) return { low, name };
  return { low, name: low.map((m) => noteName(m).replace(/\d+$/, '')).join('') };
}

export function isBassTrack(t) {
  const prog = t.instrumentId;
  const low = t.tuning ? Math.min(...t.tuning) : 99;
  if (BASS_PROGRAMS.has(prog)) return low <= 36;       // a few "bass" tracks carry a guitar tuning: skip
  if (prog === 43) return low <= 31;                   // contrabass part in bass range
  return false;
}

function slug(s) {
  return (s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'song';
}

// Link to a song's track (Songsterr redirects to its own spelling of the name).
export function trackUrl(song, index) {
  return `https://www.songsterr.com/a/wsa/${slug(song.artist)}-${slug(song.title)}-bass-tab-s${song.songId}t${index}`;
}

// One row per bass track of each song.
export function bassResults(songs) {
  const rows = [];
  for (const s of songs) {
    s.tracks.forEach((t, i) => {
      if (!isBassTrack(t)) return;
      const tun = tuningInfo(t.tuning);
      rows.push({
        key: `songsterr:${s.songId}:${i}`, songId: s.songId, partId: i, artistId: s.artistId,
        title: s.title, artist: s.artist, trackName: (t.name || '').split('|').map((x) => x.trim()).filter(Boolean),
        instrument: t.instrument, style: playStyleOf(t.instrument), difficulty: t.difficulty ?? null, views: t.views || 0,
        tuning: tun.name, tuningLow: tun.low, strings: tun.low.length,
        mainBass: s.popularTrackBass === i, junk: !!s.isJunk, playable: s.hasPlayer !== false,
        songViews: s.tracks.reduce((a, x) => a + (x.views || 0), 0),
        url: trackUrl(s, i),
      });
    });
  }
  return rows;
}

// filters: { tunings: [names] (empty = any), strings: [4,5,6], diffMin, diffMax, includeUnrated,
//   minViews, styles: [..] (empty = any), mainOnly, hideJunk, playableOnly,
//   library: 'any' | 'new' (not in library) | 'notMastered' | 'inLibrary' | 'favorites',
//   excludeArtists: 'a, b', artistQuery }
export function filterResults(rows, f, library = new Map()) {
  const excl = (f.excludeArtists || '').split(/[,;]/).map((x) => x.trim().toLowerCase()).filter(Boolean);
  return rows.filter((r) => {
    if (f.hideJunk && r.junk) return false;
    if (f.playableOnly && !r.playable) return false;
    if (f.mainOnly && !r.mainBass) return false;
    if (f.tunings && f.tunings.length && !f.tunings.includes(r.tuning) && !(f.tunings.includes('Other') && !TUNING_CHOICES.some(([n]) => n === r.tuning))) return false;
    if (f.strings && f.strings.length && !f.strings.includes(r.strings)) return false;
    if (r.difficulty === null) { if (!f.includeUnrated) return false; } else if (r.difficulty < (f.diffMin ?? 1) || r.difficulty > (f.diffMax ?? 99)) return false;
    if (f.minViews && r.views < f.minViews) return false;
    if (f.styles && f.styles.length && !f.styles.includes(r.style)) return false;
    if (excl.some((a) => r.artist.toLowerCase().includes(a))) return false;
    const e = library.get(r.key);
    if (f.library === 'new' && e) return false;
    if (f.library === 'inLibrary' && !e) return false;
    if (f.library === 'favorites' && !(e && e.favorite)) return false;
    if (f.library === 'notMastered' && e && e.status === 'mastered') return false;
    return true;
  });
}

export function sortResults(rows, by) {
  const cmp = {
    relevance: () => 0,
    views: (a, b) => b.views - a.views,
    easy: (a, b) => (a.difficulty ?? 99) - (b.difficulty ?? 99) || b.views - a.views,
    hard: (a, b) => (b.difficulty ?? -1) - (a.difficulty ?? -1) || b.views - a.views,
    title: (a, b) => a.title.localeCompare(b.title),
    artist: (a, b) => a.artist.localeCompare(b.artist) || a.title.localeCompare(b.title),
  }[by] || (() => 0);
  return [...rows].sort(cmp);
}

// Songsterr search: pattern ('' = most popular), bass ranking, optional exact tuning (low first).
export async function searchSongs({ pattern = '', tuning = null, from = 0, size = 100, fetchImpl = fetch } = {}) {
  const q = new URLSearchParams({ pattern, size: String(size), from: String(from), inst: 'bass' });
  if (tuning) q.set('tuning', [...tuning].reverse().join(','));
  const res = await fetchImpl(`${API}?${q}`, { credentials: 'omit' });
  if (!res.ok) throw new Error(`Songsterr search failed (${res.status})`);
  const data = await res.json();
  if (!Array.isArray(data)) throw new Error('Unexpected answer from Songsterr search');
  return data;
}

// Your level: the difficulty of bass tracks you play at 90%+ (median), or null.
export function levelFrom(entries) {
  const d = entries.filter((e) => e.difficulty && e.stats && (e.stats.bestFull ?? 0) >= 0.9).map((e) => e.difficulty).sort((a, b) => a - b);
  return d.length ? d[d.length >> 1] : null;
}
