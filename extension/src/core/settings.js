// Persistent settings. Uses chrome.storage.local inside the extension (it
// survives clearing Songsterr's site data) and localStorage elsewhere (tests).

const KEY = 'bassTrainerSettings';

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
  lookahead: 2.4,          // seconds a note is visible before it must be played
  invertStrings: false,    // false = Rocksmith (low E on top); true = tab order
  showDebug: false,
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
  cache = { ...DEFAULTS, ...stored };
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
