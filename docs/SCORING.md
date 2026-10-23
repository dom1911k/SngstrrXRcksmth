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
* **Weak low notes:** if the attack was heard but its pitch only becomes clear
  later (up to 0.35 s), the note is still reported with the attack's time.
* A note that simply keeps ringing produces **nothing new**.

## 2. Timing

A played note's audio time is converted to the page clock. Then the **calibrated
total latency** (calibration + fine-tune) is subtracted, which gives the moment you
played it relative to what you heard. The player's clock turns that into a position
in the song. Windows are in **real time**, so 50% speed is not easier or harder in ms.

| Setting | Default | Meaning |
|---|---|---|
| Timing window | ±140 ms (Strict 80, Relaxed 190; 0.6.1, was 110) | how early/late a note may be |
| On time | ±50 ms | inside this = "on time", otherwise "early"/"late" |
| Pitch tolerance | ±50 cents | |

**Fast passages:** a note's window shrinks to 60% of the distance to its
neighbours (never below 50 ms), so neighbouring windows overlap only a little. Each played note is used
for **at most one** expected note: the closest one with the right pitch.

**Automatic timing correction** (on by default): after every 12 timing
measurements (hits, plus right notes just outside the window), the session takes
their median. If it's 8 ms or more off, it moves a learned correction 60% of the way
towards it (limit ±100 ms). It is added to calibration + fine-tune and shown in the
panel, with a Reset button. A new calibration resets it. This removes constant
offsets, e.g. Songsterr's audio path being slightly slower than the calibration
clicks, so correctly played notes aren't lost to a technicality. Single early/late
notes don't move it. With it turned off, the summary offers a one-click **Apply**
instead.

## 3. Edge cases

| Case | Handling |
|---|---|
| Normal note | Hit if a played note with an attack is inside its window **and** within ±50 cents. |
| Wrong note | Miss. The miss records **what you played** ("played D2, not C2"); the summary lists repeated differences so you can tell a tab error from your own mistake. |
| Nothing played | Miss ("not heard"). |
| Right note, no attack detected (very soft pluck) | **Hit** if the right pitch appears inside the window and no attack-based match exists. Counted as "soft pluck" in the summary. |
| Right note, but just outside the window | Miss ("right note but too early/late"), and it feeds the automatic timing correction. |
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
| Seek | Starts a new pass from the new position. Notes before it aren't counted as misses. If you played at least 12 notes before jumping, that part is saved to the practice history. |
| Input off / wait mode / take playback | Nothing is scored. Starting the input starts a new pass at the current position, so notes that went by while it was off are not misses. |
| Loop | Each loop pass is scored separately. Notes you play right before the loop jumps back still count for the pass they belong to, because the old pass stays open for latency + 0.3 s. A short pop-up shows each pass's result. |
| End of song | A summary card: accuracy, early/on time/late/missed, **why** notes were missed (not heard / timing / different note), average timing, bars to practise, notes that differed from the tab. |

There are **no per-note hit/miss markers** on the highway (by design: a "miss" flash
for a note you played right but that the detector misjudged is worse than no
flash). Live feedback is only the small accuracy % and streak (can be hidden).

## 4. Known limitations

* A soft pluck of the **same** pitch as the note still ringing has neither an
  attack nor a pitch change, so it can't be detected.
* String/fret position can't be verified: E string fret 5 = A string open.
* Polyphony isn't scored (see chords).
