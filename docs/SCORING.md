# How scoring works

Code: `extension/src/scoring/` (`detector.js`, `scorer.js`, `session.js`).
Tests: `tests/scorer.test.mjs` (rules), `tests/pipeline.test.mjs` (audio → score on
21 Guns), `tests/session.test.mjs` (latency, loops), `tests/e2e-scoring.mjs` (browser).

## 1. From your bass to "played notes"

The AudioWorklet reports **attacks** (onsets) and a **pitch** every ~5 ms
(see ARCHITECTURE §6). `NoteEventDetector` turns these into played notes:

* **Time** = the attack time (accurate to a few ms).
* **Pitch** = median of the first stable stretch after the attack (≥ 4 frames
  agreeing within 45 cents, ignoring the first 12 ms of pick noise). It waits at
  most 140 ms. If no clear pitch appears, the note has **no pitch** (typical for
  dead/muted notes).
* **Pitch change without an attack** (≥ 0.75 semitones, stable, not right after an
  attack) → a *legato* played note: hammer-on, pull-off, or slide arrival.
* A note that simply keeps ringing produces **nothing new**.

## 2. Timing

A played note's audio time is converted to the page clock. Then the **calibrated
total latency** (calibration + fine-tune) is subtracted, which gives the moment you
played it relative to what you heard. The player's clock turns that into a position
in the song. Windows are in **real time**, so 50% speed is not easier or harder in ms.

| Setting | Default | Meaning |
|---|---|---|
| Timing window | ±110 ms (Strict 70, Relaxed 160) | how early/late a note may be |
| On time | ±40 ms | inside this = "on time", otherwise "early"/"late" |
| Pitch tolerance | ±50 cents | |

**Fast passages:** a note's window shrinks to half the distance to its
neighbours (never below 35 ms), so windows never overlap. Each played note is used
for **at most one** expected note: the closest one with the right pitch.

**Self-check:** the summary shows your average offset. If you felt in time but it
says e.g. "+30 ms late", **Apply** adds that to the fine-tune.

## 3. Edge cases

| Case | Handling |
|---|---|
| Normal note | Hit if a played note with an attack is inside its window **and** within ±50 cents. |
| Wrong note | Miss. The miss records **what you played** ("played D2, not C2"); the summary lists repeated differences so you can tell a tab error from your own mistake. |
| Nothing played | Miss. |
| Previous note still ringing | Never counts: a hit needs a **new attack** (or a pitch change for hammer-ons). Re-plucking the same note is detected as a new attack. |
| Octave errors | A pitch exactly ±12 semitones from the expected note counts as a **hit**, flagged "octave-ambiguous" (the detector, not you, is the likely cause). |
| Harmonics | ±12, +19, +24 semitones also count. |
| Dead note (x) | Default: **any muted attack** inside the window is a hit, with or without pitch. Option: *not scored*. |
| Ghost note | Not scored (shown dimmed). |
| Slides | The start note is scored normally. The destination of a *legato* slide (no new pick) is **not scored**. The destination of a *shift* slide (picked again) is a normal note. The pitch glide in between can't hit anything, because legato pitch changes only count for hammer-on/pull-off notes. |
| Hammer-on / pull-off | The destination note accepts a **pitch change without attack** (or a normal attack). |
| Tied notes | Already merged into one longer note by the converter: one hit. |
| Chords / double stops | The detector hears one pitch at a time, so only the **lowest** note of simultaneous notes is scored; the others are skipped. |
| Count-in, pause | Nothing is scored while paused or counting in; notes played then are ignored (tune freely). |
| Seek | Starts a new pass from the new position. Notes before it aren't counted as misses. |
| Loop | Each loop pass is scored separately. Notes you play right before the loop jumps back still count for the pass they belong to, because the old pass stays open for latency + 0.3 s. A short pop-up shows each pass's result. |
| End of song | A summary card: accuracy, early/on time/late/missed, average timing, bars to practise, notes that differed from the tab. |

## 4. Known limitations

* Very soft fingerstyle attacks with no finger noise at all may not be detected
  as attacks (they still score via pitch change only on hammer-on/pull-off notes).
* String/fret position can't be verified: E string fret 5 = A string open.
* Polyphony isn't scored (see chords).
