// Pitch helpers and tuning presets. MIDI note numbers throughout; tunings are
// listed LOWEST string first (same as the chart format).

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export function midiToFreq(midi, refA = 440) {
  return refA * Math.pow(2, (midi - 69) / 12);
}

export function freqToMidi(freq, refA = 440) {
  return 69 + 12 * Math.log2(freq / refA);
}

export function noteName(midi) {
  const m = Math.round(midi);
  return NOTE_NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
}

export function noteNameNoOctave(midi) {
  const m = Math.round(midi);
  return NOTE_NAMES[((m % 12) + 12) % 12];
}

export const TUNINGS = {
  'E Standard': [28, 33, 38, 43],
  'Drop D': [26, 33, 38, 43],
  'Eb Standard': [27, 32, 37, 42],
  'D Standard': [26, 31, 36, 41],
  'Drop C': [24, 31, 36, 41],
  'B Standard (5-string)': [23, 28, 33, 38, 43],
};

export function tuningName(tuning) {
  for (const [name, t] of Object.entries(TUNINGS)) {
    if (t.length === tuning.length && t.every((v, i) => v === tuning[i])) return name;
  }
  return tuning.map(noteNameNoOctave).join(' ');
}

// Rocksmith 2014 string colours for bass, lowest string first. A 5th (low B)
// string has no Rocksmith colour; green is used so the E..G colours stay put.
export const STRING_COLORS_4 = ['#e8202a', '#f2c418', '#1e8ff0', '#f28a1c'];
export const STRING_COLORS_5 = ['#3dbb4a', ...STRING_COLORS_4];

export function stringColors(stringCount) {
  return stringCount >= 5 ? STRING_COLORS_5 : STRING_COLORS_4;
}

// Lowest frequency the pitch detector must handle for a tuning: a little
// below the lowest open string so a flat string is still detected.
export function detectorMinFreq(tuning, refA = 440) {
  return midiToFreq(Math.min(...tuning) - 2, refA);
}
