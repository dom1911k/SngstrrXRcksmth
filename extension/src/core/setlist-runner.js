// While a setlist is being played: records each finished song's score and
// tells the end screen what comes next.
import { getRun, setRun, recordRunScore, runSummary } from './setlists.js';
import { libraryStore } from './library.js';

export function urlForEntry(e) {
  const ext = typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL;
  if (e.kind === 'local') return ext ? chrome.runtime.getURL(`player/player.html?song=${encodeURIComponent(e.songKey)}`) : null;
  if (e.kind === 'drill') return ext ? chrome.runtime.getURL(`player/player.html?drill=${encodeURIComponent(e.drillId)}`) : null;
  const m = e.songKey.match(/^songsterr:(\d+):(\d+)$/);
  return e.url || (m ? `https://www.songsterr.com/a/wa/song?id=${m[1]}` : null);
}

export class SetlistRunner {
  constructor(tracker, { store = libraryStore() } = {}) {
    this.tracker = tracker;
    this.store = store;
  }

  // Called with the end-of-song summary. Returns null when no setlist is
  // running for this song, else { name, played, total, average, done, next }.
  async onSongEnd(summary) {
    const run = await getRun();
    const key = this.tracker.entry && this.tracker.entry.songKey;
    if (!run || !key || run.songKeys[run.index] !== key) return null;
    const next = recordRunScore(run, key, summary.accuracy);
    const sum = runSummary(next);
    await setRun(sum.done ? null : next);
    let nextEntry = null;
    if (!sum.done) nextEntry = await (await this.store).get(sum.nextKey);
    return { name: run.name, ...sum, next: nextEntry };
  }

  open(entry) {
    const url = urlForEntry(entry);
    if (url) location.href = url;
  }
}
