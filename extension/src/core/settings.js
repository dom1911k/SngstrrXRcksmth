// Persistent settings. Uses chrome.storage.local inside the extension (it
// survives clearing Songsterr's site data) and localStorage elsewhere (tests).

const KEY = 'bassTrainerSettings';
const SCHEMA = 6;
const PANEL_FOLDED = ['Scoring', 'Note detection', 'Playback', 'Hear yourself (monitoring)', 'Record & listen back', 'Shortcuts (keyboard or foot pedal)'];

// Adjust settings saved by older versions.
function migrate(stored) {
  const v = stored.schema || 1;
  if (v < 2) {
    // 0.3.0: longer default look-ahead for the 3D highway.
    if (stored.lookahead === undefined || stored.lookahead <= 2.4) stored.lookahead = 3.5;
  }
  if (v < 3) {
    // 0.5.1: lower, wider camera shows further ahead; give it more time.
    if (stored.lookahead === undefined || stored.lookahead <= 3.5) stored.lookahead = 4.5;
  }
  if (v < 4) {
    // 0.6.1: more forgiving timing windows.
    const map = { 70: 80, 110: 140, 160: 190 };
    if (stored.hitWindowMs === undefined || map[stored.hitWindowMs]) stored.hitWindowMs = map[stored.hitWindowMs] || 140;
    if (stored.onTimeMs === undefined || stored.onTimeMs === 40) stored.onTimeMs = 50;
  }
  if (v < 5) {
    // 0.12.1: notes as in Rocksmith 2014: no fret numbers on the notes, no
    // approach rings (both can be switched back on).
    stored.gemFretNumbers = false;
    stored.approachRings = false;
  }
  if (v < 6) {
    // 0.13.1: panel reordered and renamed; fold the less used sections.
    stored.panelCollapsed = [...PANEL_FOLDED];
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
  lookahead: 4.5,          // seconds a note is visible before it must be played
  highwayStyle: '3d',      // '3d' (Rocksmith-style, WebGL) | '2d'
  gemFretNumbers: false,   // fret numbers on the 3D note gems (Rocksmith 2014 has none)
  invertStrings: false,    // false = Rocksmith (low E on top); true = tab order
  showDebug: false,
  hitSparks: true,         // sparks on the strings when you hit a note (3D)
  timingMarks: false,      // small early/late dot after each hit (3D)
  approachRings: false,    // a ring closes in on each note's target (3D; not in Rocksmith)
  stageEffects: true,      // stage lights react to your streak, floating dust, vignette (3D)
  glowEffects: true,       // soft glow (bloom) on strings and notes (3D)
  theme: 'classic',        // 3D look: 'classic' | 'stage' | 'minimal' | 'contrast'
  largeNotes: false,       // 30% bigger notes (3D)
  graphicsQuality: 'auto', // 'auto' | 'high' | 'low' (3D)
  // Scoring
  scoring: true,
  hitWindowMs: 140,        // how early/late a note may be and still count
  onTimeMs: 50,            // within this it is "on time"
  deadNotes: 'attack',
  detectSensitivity: 'normal', // note detection: 'low' | 'normal' | 'high' | 'max' (core/detection.js)
  pitchToleranceCents: 50, // how far off a note may be and still count
     // 'attack' = any muted attack counts | 'ignore'
  showLiveScore: true,     // accuracy % and streak above the highway
  // Practice
  autoMuteBass: true,      // mute the song's bass track while the input is on
  countIn: true,           // standalone player: one bar of clicks before playing
  countInLoops: true,      // ...and before each loop restart
  // Riff repeater (auto speed-up on loops)
  riffRepeater: false,
  rrStartSpeed: 70,        // %
  rrStep: 5,               // % per successful pass
  rrTarget: 90,            // accuracy % needed for the next step
  rrMaxSpeed: 100,         // %
  rrAdvance: true,         // phrase ladder: when a loop is mastered, move on to the next phrase
  showSectionBar: true,    // section strip with your weak spots above the highway
  shortcuts: {},           // action -> [bindings]; empty = defaults
  panelCollapsed: [...PANEL_FOLDED], // folded panel sections (by heading)
  autoTiming: true,        // learn a small timing correction while playing
  autoTimingMs: 0,         // the learned correction (added to the latency)
  autoTimingBySource: {},  // learned correction per sound source (Songsterr ORIG / SYNTH, audio file)
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
  return (s.calibrationMs || 0) + (s.fineTuneMs || 0) + (s.autoTiming ? s.autoTimingMs || 0 : 0);
}
