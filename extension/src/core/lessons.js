// Lessons: step-by-step courses built from the drills. Each lesson explains a
// technique, then has two or three scored steps (a drill at a set tempo that
// you pass by reaching the target accuracy at full speed), and ends with an
// "apply it" step: use it in a song from your Library.
//
// Progress is kept in chrome.storage.local ('lessonProgress'):
//   { [lessonId]: { passed: [stepIndex, ...], best: { [stepIndex]: accuracy }, at } }

export const LESSONS = [
  {
    id: 'beat', title: 'Find the beat', level: 'Start here',
    intro: 'Everything on bass starts with time. Play steady eighth notes on the open strings and land exactly on the click. Let the plucking hand alternate index and middle finger, and keep each note the same length.',
    tips: ['Count "1 and 2 and…" out loud.', 'Mute the strings you are not playing with the side of your plucking hand.'],
    steps: [
      { drill: 'lock-in', bpm: 70, bars: 6, target: 0.85, title: 'Open strings at 70 BPM' },
      { drill: 'lock-in', bpm: 90, bars: 8, target: 0.85, title: 'Rising tempo from 90 BPM' },
    ],
    apply: 'Pick a slow song in your Library and play only the first note of every bar, exactly with the band.',
  },
  {
    id: 'one-finger', title: 'One finger per fret', level: 'Start here',
    intro: 'Your fretting hand covers four frets: index, middle, ring and little finger, one per fret. Press right behind the fret wire, with the thumb behind the neck, and keep the fingers close to the strings.',
    tips: ['Leave each finger down until you need it again.', 'Slow and clean beats fast and buzzy.'],
    steps: [
      { drill: 'chromatic', bpm: 60, bars: 4, position: 5, target: 0.85, title: 'Chromatic at fret 5, 60 BPM' },
      { drill: 'chromatic', bpm: 80, bars: 8, position: 1, target: 0.85, title: 'Up the neck from fret 1, 80 BPM' },
    ],
    apply: 'Find a riff in your Library that stays in one hand position and loop its first phrase (panel → Loop this phrase).',
  },
  {
    id: 'roots', title: 'Roots and fifths', level: 'Basics',
    intro: 'The root is the note the chord is named after; the fifth is two frets up on the next string. Root–fifth–octave is the backbone of countless bass lines in rock, country and pop.',
    tips: ['Keep the same hand shape and move it as one block.', 'Let every note ring for its full length.'],
    steps: [
      { drill: 'root-fifth', bpm: 70, bars: 8, target: 0.85, title: 'Root–fifth–octave at 70 BPM' },
      { drill: 'root-fifth', bpm: 95, bars: 8, target: 0.85, title: '…at 95 BPM' },
    ],
    apply: 'Open a song you are learning and look for roots and fifths in its chorus: loop the phrase and play it along.',
  },
  {
    id: 'octaves', title: 'Octaves', level: 'Basics',
    intro: 'The octave is the same note, higher: two strings up and two frets up. Finger 1 on the root, finger 3 or 4 on the octave. Mute the string in between with the underside of finger 1.',
    tips: ['Pluck the root with the index finger and the octave with the middle finger.', 'Disco and punk love octaves!'],
    steps: [
      { drill: 'octaves', bpm: 70, bars: 8, target: 0.85, title: 'Octaves at 70 BPM' },
      { drill: 'octaves', bpm: 100, bars: 8, target: 0.85, title: 'Octaves at 100 BPM' },
    ],
    apply: 'Find a song with an octave line in your Library (or search "disco" in Find songs) and loop a phrase.',
  },
  {
    id: 'crossing', title: 'String crossing', level: 'Basics',
    intro: 'Moving between strings without extra noise: the plucking finger comes to rest on the next lower string (rest stroke), and the fretting fingers lift just enough to mute.',
    tips: ['Fingers 1 and 3 on one string, 2 and 4 on the next.', 'Stop a string ringing by lifting the finger slightly, not away.'],
    steps: [
      { drill: 'spider', bpm: 60, bars: 8, target: 0.85, title: 'Spider at 60 BPM' },
      { drill: 'spider', bpm: 80, bars: 8, target: 0.85, title: 'Spider at 80 BPM' },
    ],
    apply: 'Loop the busiest phrase of a song you are learning at 70% speed with the riff repeater.',
  },
  {
    id: 'scale', title: 'The major scale', level: 'Intermediate',
    intro: 'Do-re-mi on the bass: start with finger 2 on the root on the E string. Knowing the scale shape helps you find passing notes and understand bass lines.',
    tips: ['Say the note names while you play.', 'Use the fretboard trainer to learn the notes on the neck.'],
    steps: [
      { drill: 'major-scale', bpm: 60, bars: 8, target: 0.85, title: 'Major scale at 60 BPM' },
      { drill: 'major-scale', bpm: 85, bars: 8, target: 0.85, title: 'Major scale at 85 BPM' },
    ],
    apply: 'Pick a song in a major key and find the scale notes its bass line uses between the roots.',
  },
  {
    id: 'legato', title: 'Hammer-ons & pull-offs', level: 'Intermediate',
    intro: 'Play two notes with one pluck: pluck the first, then hammer a finger down two frets higher (hammer-on) or pull it off sideways to the lower note (pull-off). On the highway they are marked ▲ and ▼.',
    tips: ['Hammer with the fingertip, firmly, right behind the fret.', 'For a pull-off, flick the string slightly downwards as you let go.'],
    steps: [
      { drill: 'hammer-pull', bpm: 60, bars: 8, target: 0.8, title: 'Hammer-ons & pull-offs at 60 BPM' },
      { drill: 'hammer-pull', bpm: 80, bars: 8, target: 0.8, title: '…at 80 BPM' },
    ],
    apply: 'Search Find songs for a funk or blues song and look for ▲ ▼ on the highway.',
  },
  {
    id: 'muted', title: 'Muted notes & groove', level: 'Intermediate',
    intro: 'Muted (dead) notes, shown as X, give a groove its "chick": lay the fretting fingers on the string without pressing it down and pluck as usual. Funk and modern rock lines are full of them.',
    tips: ['Relax the fretting hand just enough that no pitch sounds.', 'Muted notes are as important for the rhythm as the real ones.'],
    steps: [
      { drill: 'muted-groove', bpm: 70, bars: 8, target: 0.8, title: 'Root and muted note at 70 BPM' },
      { drill: 'muted-groove', bpm: 95, bars: 8, target: 0.8, title: '…at 95 BPM' },
    ],
    apply: 'Find a song with X notes on the highway and loop a phrase with the riff repeater.',
  },
  {
    id: 'sixteenths', title: 'Sixteenth notes', level: 'Advanced',
    intro: 'Four notes per beat, every note equally loud and evenly spaced. Strict alternation of the plucking fingers is the key, also when you change strings.',
    tips: ['Start slower than you think.', 'Watch the timing dots (Song & highway settings) to see if you rush.'],
    steps: [
      { drill: 'sixteenths', bpm: 60, bars: 8, target: 0.8, title: 'Sixteenths at 60 BPM' },
      { drill: 'sixteenths', bpm: 80, bars: 8, target: 0.8, title: 'Sixteenths at 80 BPM' },
      { drill: 'sixteenths', bpm: 95, bars: 8, target: 0.8, title: 'Sixteenths at 95 BPM' },
    ],
    apply: 'Loop the fastest phrase of a song you love and let the riff repeater bring it up to full speed.',
  },
];

export function lessonById(id) { return LESSONS.find((l) => l.id === id) || null; }

// Step i of a lesson: 0..steps.length-1 are drills, steps.length is "apply it".
export function stepCount(lesson) { return lesson.steps.length + 1; }

// Does a finished drill pass complete this step? (full speed, target reached,
// at least half of the notes judged so a stopped run doesn't count).
export function passesStep(step, summary, noteCount) {
  if (!summary || summary.accuracy === null || summary.accuracy === undefined) return false;
  if ((summary.speed || 1) < 0.999) return false;
  if (noteCount && summary.judged < noteCount * 0.5) return false;
  return summary.accuracy >= step.target - 1e-9;
}

// Progress helpers (pure).
export function lessonState(lesson, progress = {}) {
  const p = progress[lesson.id] || { passed: [], best: {} };
  const passed = new Set(p.passed || []);
  const next = [...Array(stepCount(lesson)).keys()].find((i) => !passed.has(i));
  return {
    passed,
    best: p.best || {},
    done: next === undefined,
    next: next === undefined ? null : next,
    fraction: passed.size / stepCount(lesson),
  };
}

export function recordStep(progress, lessonId, step, accuracy = null, passed = true) {
  const p = { passed: [], best: {}, ...(progress[lessonId] || {}) };
  const best = { ...p.best };
  if (accuracy !== null) best[step] = Math.max(best[step] || 0, accuracy);
  const list = passed && !p.passed.includes(step) ? [...p.passed, step].sort((a, b) => a - b) : p.passed;
  return { ...progress, [lessonId]: { passed: list, best, at: Date.now() } };
}

// The lesson to suggest next: the first one that isn't done.
export function nextLesson(progress = {}) {
  return LESSONS.find((l) => !lessonState(l, progress).done) || null;
}

const KEY = 'lessonProgress';
const store = () => (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local ? chrome.storage.local : null);

export async function loadLessonProgress() {
  const s = store();
  if (s) return (await s.get(KEY))[KEY] || {};
  try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; }
}

export async function saveLessonProgress(progress) {
  const s = store();
  if (s) await s.set({ [KEY]: progress });
  else localStorage.setItem(KEY, JSON.stringify(progress));
}
