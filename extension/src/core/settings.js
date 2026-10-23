// Persistent settings. Uses chrome.storage.local inside the extension (it
// survives clearing Songsterr's site data) and localStorage elsewhere (tests).

const KEY = 'bassTrainerSettings';
const SCHEMA = 2;

// Adjust settings saved by older versions.
function migrate(stored) {
  const v = stored.schema || 1;
  if (v < 2) {
    // 0.3.0: longer default look-ahead for the 3D highway.
    if (stored.lookahead === undefined || stored.lookahead <= 2.4) stored.lookahead = 3.5;
  }
  stored.schema = SCHEMA;
  return stored;
}

export const DEFAULTS = {
  deviceId: '',
  deviceLabel: '',
  tuningName: 'E Standard',
  refA: 440,
  // Latency: measured by calibration, plus a manual fine-tune on top.
  calibrationMs: null,
  calibrationSpreadMs: null,
  calibratedAt: null,
  fineTuneMs: 0,
  lowLatency: true,
  // Highway
  viewMode: 'both',        // 'both' | 'highway' | 'tab'
  highwayHeight: 0.42,     // fraction of the window height in 'both' mode
  visualDelayMs: 60,       // shift the highway so notes cross the line when you HEAR them
  lookahead: 3.5,          // seconds a note is visible before it must be played
  highwayStyle: '3d',      // '3d' (Rocksmith-style, WebGL) | '2d'
  gemFretNumbers: true,    // fret numbers on the 3D note gems
  invertStrings: false,    // false = Rocksmith (low E on top); true = tab order
  showDebug: false,
  schema: SCHEMA,
};

const hasChromeStorage = typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;

let cache = null;
const listeners = new Set();

export async function loadSettings() {
  if (cache) return cache;
  let stored = {};
  try {
    if (hasChromeStorage) {
      stored = (await chrome.storage.local.get(KEY))[KEY] || {};
    } else {
      stored = JSON.parse(localStorage.getItem(KEY) || '{}');
    }
  } catch (err) {
    console.warn('[Bass Trainer] could not read settings', err);
  }
  cache = { ...DEFAULTS, ...migrate(stored) };
  return cache;
}

export function getSettings() {
  if (!cache) throw new Error('settings not loaded');
  return cache;
}

export async function updateSettings(patch) {
  cache = { ...(cache || DEFAULTS), ...patch };
  try {
    if (hasChromeStorage) {
      await chrome.storage.local.set({ [KEY]: cache });
    } else {
      localStorage.setItem(KEY, JSON.stringify(cache));
    }
  } catch (err) {
    console.warn('[Bass Trainer] could not save settings', err);
  }
  for (const fn of listeners) fn(cache);
  return cache;
}

export function onSettingsChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Total offset applied to every timing judgment, in milliseconds.
export function totalLatencyMs(s = getSettings()) {
  return (s.calibrationMs || 0) + (s.fineTuneMs || 0);
}
