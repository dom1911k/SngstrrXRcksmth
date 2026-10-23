# Bass Trainer for Songsterr: Architecture Proposal

Status: **Phase 1 built** (input, tuner, monitoring, calibration). This file
is the design reference for all phases and is kept up to date.

## 0. Decisions (from the owner, October 2026)

| Question | Decision |
|---|---|
| Highway look | Mirror **Rocksmith 2014** as closely as possible in 2D: notes approach from the distance down a perspective highway toward the fretboard at the bottom, horizontal position = fret, lane/colour = string, fret numbers on gems, sustain tails, highlighted anchor (hand-position) zone, low E drawn at the top as in Rocksmith's default (an "invert strings" option for tab order). The 3D version (V3) keeps the same layout with a real camera. |
| String colours | Rocksmith 2014: E red, A yellow, D blue, G orange. 5-string low B: green (Rocksmith bass has no 5th colour). |
| Dead notes (x) | Any muted attack in the window counts as a hit. |
| Updating | No Git: README describes Download ZIP → extract into the same folder → reload. Manifest has a fixed `key` so the extension ID (and saved settings) survive moving the folder. |
| Acceptance songs | Green Day: *Good Riddance (Time of Your Life)*, *21 Guns*; La Sera: *Love That's Gone*. |


---

## 1. What I found in Songsterr (October 2026)

Inspected from the public tab page (`/a/wsa/metallica-enter-sandman-tab-s19`)
and Songsterr's shipped JavaScript. Your logged-in session could not be checked
from my cloud machine, so Phase 2 includes a diagnostics panel to confirm these
findings in your browser.

| Topic | Finding | Consequence |
|---|---|---|
| Content Security Policy | No CSP header and no CSP `<meta>` on tab pages. | Overlay, worklets and canvas are not blocked today. An extension is unaffected even if they add a CSP later. |
| Song metadata | Every tab page embeds `<script id="state" type="application/json">` with `meta.current`: songId, revisionId, the track list with **tuning as MIDI numbers** (e.g. bass `[43,38,33,28]` = G D A E), `isBassGuitar`, `popularTrackBass`. | Tuning and bass-track detection come from structured data. No scraping needed. |
| Note data | Each track loads as a JSON document: `measures[] → voices[] → beats[] → notes[]`, with `fret`, `string` (0 = highest string), `duration` `[1,8]`, `dots`, `tie`, `dead`, `ghost`, `hp` (hammer/pull), `slide` (`"legato"`, `"shift"`, …), `letRing`, `staccato`, `accentuated`, plus `signature`, `marker` (section names) and `automations.tempo`. | Clean structured source for the chart converter. The adapter reads what the page has already loaded instead of fetching anything extra. |
| App state | Preact 10 with a *storeon* store (`dispatch('player/togglePlay')`, `on('@changed')`, …). In production the store is **not** exposed on `window` (`window.__store__` is only set on non-prod builds). | The adapter must find the store through Preact's component tree from `#root`. This is the most fragile part, and all of it stays inside the adapter. |
| Playback position | `state.player.instance` has `getCurrentTime()` and `getPosition() → {cursor, loopStart, loopEnd}`. `state.playings.playings` is the generated **playback timeline** (repeats unrolled, tempo applied). `state.player.speed`, `shouldPlay`, `isCountin`, `isCountinBetweenLoops`. | We can read the exact player clock instead of watching the moving cursor, and resync from it every frame. |
| Events | `player/togglePlay`, `player/changeSpeed`, `player/toggleLoop`, `cursor/move`, `cursor/loop`, `player/toggleCountIn`, `player/toggleCountInBetweenLoops`, `player/setMixerPlayableParts` (mute/solo; `partsMute` in state). | Play/pause/seek/loop/speed are store events we can subscribe to. **Count-in and count-in between loops already exist natively**, so we drive Songsterr's own count-in instead of building a second one. |
| Audio engine | Songsterr decodes in a Web Worker and plays through its own `AudioContext` + AudioWorklet. When exactly one part is muted and it is bass, Songsterr loads a dedicated "minus" mix (`…/m/{partId}.opus`). | Muting the bass through Songsterr's own mixer gives you a real backing track without bass. |
| Built-in latency | `state.audioLatencyOffset.ms` (Songsterr's own audio-latency setting). | The adapter reports it so we don't compensate twice. |
| Songsterr's own mic feature | `liveScroll` (mic-driven scrolling) exists. | Songsterr already asks for mic permission on this site, so ours won't be unusual. We won't run both at once. |

Nothing here uses or unlocks Plus-only features. The trainer only reads what
your logged-in page has already loaded and presses the same buttons you would.

---

## 2. Userscript or Chrome extension → **unpacked Chrome extension (MV3)**

| Concern | Tampermonkey userscript | Unpacked extension |
|---|---|---|
| AudioWorklet module | Needs a `blob:` URL. Breaks as soon as Songsterr adds a CSP. | Loaded from the extension's own files. Not affected by page CSP. |
| Access to Songsterr's store (page JS world) | `@grant none` / `unsafeWindow`. Works. | `"world": "MAIN"` content script. Works and is officially supported. |
| Storage (calibration, settings, V2 stats) | `GM_setValue` (small) or Songsterr's own IndexedDB (gets wiped with site data). | `chrome.storage.local` plus extension-owned IndexedDB. Survives clearing Songsterr's cookies. |
| Multiple files / modules | One big file. | Normal folder of files. |
| V3: standalone player with local audio + chart | Not possible without a host page. | An extension page (`trainer.html`) can host it with no server. |
| Install | Tampermonkey, then Chrome's "Allow User Scripts" toggle (required in current Chrome), then paste the script. | Chrome Developer mode, then "Load unpacked", then pick the folder. |
| Updating | Can auto-update. | Download the new ZIP (or `git pull`), replace the folder, click ⟳ on `chrome://extensions`. About 30 seconds. |

Choice: **extension**. The worklet/CSP issue and the V3 standalone page decide
it. The only cost is a manual update step, which the README will walk through.
There is **no build step**: the repository folder *is* the extension, plain
JavaScript, so updating never needs Node or any tools.

---

## 3. Module layout

```
extension/
  manifest.json
  content/loader.js       (imports src/main.js as a module)
  src/                    (everything below lives in extension/src/)
  adapters/
    songsterr/            ← the ONLY Songsterr-specific code
      page-bridge.js      (MAIN world: finds the store, reads player clock, dispatches)
      adapter.js          (isolated world: talks to bridge, emits typed events)
      to-chart.js         (Songsterr part JSON + playback timeline → chart JSON)
  core/
    music.js              note/frequency maths, tuning presets, Rocksmith colours
    tuner.js              tuner model (steady reading, tuning-mismatch warnings)
    chart.js              chart schema, validation, helpers (string→MIDI, etc.)
    clock.js              "song time now" = player time + latency compensation, smoothing
    settings.js           chrome.storage wrapper (calibration, keybindings, device id)
  audio/
    engine.js             device picker, getUserMedia (all processing OFF), AudioContext,
                          monitoring gain (default 0), click generator
    pitch-worklet.js      AudioWorklet: onset detector + McLeod (MPM) pitch detector
    calibration.js        play-along clicks + offset measurement
  scoring/
    matcher.js            expected notes ↔ detected events, tolerance windows
    rules.js              edge-case policy (dead/ghost/slide/ringing/octave/fast)
    session.js            accuracy, streak, per-bar results, summary
  ui/
    panel.js              Phase 1 panel (input, tuner, monitoring, calibration)
    overlay.js            shadow-DOM container on the Songsterr page, view modes
    highway2d.js          canvas renderer (60 fps, requestAnimationFrame)
    summary.js            end-of-song / end-of-loop summary
  input/
    shortcuts.js          configurable keyboard map (foot pedal = keystrokes)
docs/
  ARCHITECTURE.md  CHART_FORMAT.md  SCORING.md
README.md
```

Rule: `core/`, `audio/`, `scoring/`, `ui/` never mention Songsterr. They talk
to a **Player Adapter interface**:

```js
adapter.getChart()            → Chart (see §4)
adapter.getTime()             → { songTime /*s, chart timeline*/, perfNow, playing, speed }
adapter.on('play'|'pause'|'seek'|'loop'|'speed'|'countin'|'songchange', fn)
adapter.play(), pause(), seek(t), setLoop(a,b)|clearLoop(), setSpeed(pct)
adapter.setTrackMuted(partId, bool), getCountIn()/setCountIn(bool)
adapter.getOutputLatencyHint() → Songsterr's own latency offset, to avoid double compensation
```

V3's local-file player is just a second adapter (an `<audio>` element + a chart
file) implementing the same interface.

---

## 4. Chart format (summary; full spec goes in `docs/CHART_FORMAT.md`)

```jsonc
{
  "format": "bass-chart", "version": 1,
  "meta": { "title": "Enter Sandman", "artist": "Metallica",
            "source": { "type": "songsterr", "songId": 19, "revisionId": 9400260, "partId": 6 } },
  "instrument": { "strings": 4, "tuning": [28, 33, 38, 43] },  // MIDI, LOWEST string first
  "timeline": "seconds at 100% speed, repeats unrolled, t=0 = start of first bar",
  "bars":  [ { "i": 0, "t": 0.0, "sourceBar": 0, "sig": [4,4], "bpm": 123, "section": "Intro" } ],
  "beats": [ { "t": 0.0, "bar": 0, "downbeat": true } ],
  "notes": [ { "t": 4.39, "dur": 0.24, "string": 0, "fret": 0, "midi": 28, "bar": 9,
               "flags": { "dead": false, "ghost": false, "tie": false, "hopo": false,
                          "slide": null /* {type, toFret} */, "bend": null,
                          "harmonic": false, "palmMute": false, "staccato": false,
                          "accent": false, "letRing": false, "grace": false } } ]
}
```

* `string` 0 = lowest string (opposite of Songsterr's numbering; the converter flips it).
* `midi` is redundant (`tuning[string] + fret`) but lets an external tool skip that math.
* Tied notes are merged into the first note's `dur` (one hit, longer tail).
* A chart from your own tool plus a local audio file loads the same way in V3.

---

## 5. Timing model

```
judged_time = detected_onset_time − calibration_offset
expected    = note.t (chart seconds) mapped to wall clock through the adapter's player clock
```

* **One clock.** Each animation frame the adapter samples
  `player.getCurrentTime()` together with `performance.now()`. Between samples
  we extrapolate at `speed`. If extrapolation and the player differ by more
  than 30 ms (or after any seek/loop/play event) we snap to the player.
  So the highway resyncs instead of drifting.
* **Audio events** from the worklet carry an `AudioContext` timestamp,
  converted to `performance.now()` with `getOutputTimestamp()` /
  `currentTime` pairs. This keeps the main thread's frame timing out of the judgment.
* **Calibration offset** = everything between "Songsterr's audio leaves the
  program" and "my worklet reports the onset": headphone dongle + output
  buffer + your reaction pattern + cable/input buffer + detector delay.
  Measured by playing along to about 16 clicks (median, outliers rejected),
  stored, with a ±1 ms manual fine-tune slider.
* Speed changes do not change latency (it's milliseconds of real time), so
  the offset is applied in real time, not song time.

---

## 6. Pitch detection

* Input: `getUserMedia({audio:{deviceId, echoCancellation:false,
  noiseSuppression:false, autoGainControl:false, channelCount:1}})`, plus
  Chrome's `googAutoGainControl`-style legacy flags off. `AudioContext` with
  `latencyHint:'interactive'` at the device's native rate (Real Tone Cable = 48 kHz).
* **Onset detector** (timing): two high-passed bands (>250 Hz string attack,
  >1.5 kHz pick/finger click), energy smoothed over ~10 ms, compared with the
  *loudest* level of the previous ~48 ms. A ringing note never exceeds its own
  recent maximum, so only a new attack fires, including re-plucking a ringing
  string. A 50 ms refractory period applies. Tested: within 6 ms of the true attack.
  Limitation: attacks with no click at all (very soft fingerstyle) are missed. Phase 3
  adds a "pitch changed to a new stable note" trigger for these and for hammer-ons.
* **Pitch detector**: McLeod Pitch Method (MPM / NSDF). It handles bass
  octave errors better than plain YIN, using a "first peak above k·max" rule.
  Runs on a 4× decimated signal (~12 kHz, 2 kHz anti-alias low-pass). The window
  is two periods of the lowest expected note (two semitones below the lowest
  string): ≈53 ms for E Standard, ≈71 ms for 5-string B. Hop ≈5 ms.
  Tested: within 2 cents on synthetic E1–G4 plucks at 44.1/48 kHz; low E locks
  within 80 ms of the attack; weak-fundamental low E has no octave error.
* Pitch is reported per onset as "the stable pitch in the first 30–80 ms
  after the onset". Timing comes from the onset, not from when pitch locked.
* The tuner uses the same detector with a longer window and smoothing,
  aiming for ±2 cents vs. a hardware tuner.

---

## 7. Scoring edge cases (policy; full table in `docs/SCORING.md`)

| Case | Handling |
|---|---|
| Normal note | Hit if an onset falls in `[t−window, t+window]` (default ±100 ms, "on time" ±35 ms) and its pitch is within ±50 cents of `midi`. |
| Octave error | A pitch exactly ±12 semitones is re-checked against the spectrum's fundamental. If still ambiguous it counts as a hit flagged "octave?" so it shows up in the log, not as a miss. |
| Previous note ringing | Hit requires a **new onset**. A sustained pitch that simply continues never scores. Repeated same-pitch notes are found by the amplitude re-attack. |
| Dead note `x` | Default: any onset with no stable pitch (or any onset) in the window = hit. Option: ignore. |
| Ghost note | Ignored (shown dimmed, not scored, not a miss). |
| Slides | Scored on the start note only. The pitch glide afterwards never creates a miss or a false hit on the destination note, which is skipped if it is a slide target. |
| Hammer-on / pull-off | No pick attack, so the onset detector is supplemented by a "pitch change within a sustained note" event for `hopo` notes. |
| Tied notes | Merged; one hit. |
| Fast passages | Each onset is assigned to **at most one** expected note: nearest unmatched note with matching pitch first, then nearest in time. Windows shrink to half the gap between neighbouring notes when notes are closer than 2× the window. |
| Chords / double stops | Rare on bass. Scored on the lowest note only (monophonic detector). Documented limitation. |
| Wrong note played | Logged with "played X, expected Y" and shown on the highway, so a wrong tab is easy to tell from your own mistake. |

---

## 8. Risky parts (most to least risky)

1. **Getting at Songsterr's store in production.** We find it by walking Preact's internal
   component tree (`#root` → vnode → a context provider holding `{get, on, dispatch}`).
   If Songsterr changes framework or build, this breaks. Mitigation: it all lives in
   `page-bridge.js` with a version check, a diagnostics panel, and a degraded
   fallback (read the timeline + watch the visual cursor) so a Songsterr
   update means "the highway may be a little less tight", not "broken".
2. **Units of `getCurrentTime()` and how it maps to the playback timeline** with
   repeats, tempo changes, count-in, and speed. To be verified in Phase 2 on your 3 songs.
3. **Two audio clocks.** Songsterr's AudioContext and ours run on the same output
   device but are separate objects. Calibration captures the combined
   offset, but if Songsterr's context has a different buffer size than ours
   there may be a constant error of about 10 ms. Manual fine-tuning covers it. Phase 2
   adds a "tap along to the song" check to verify.
4. **2.4 GHz headset latency** (≈20–40 ms on top of Chrome's ≈20–40 ms) can change
   after the dongle reconnects or the headset sleeps. A recalibrate button is always
   one click away, and the measured value is shown next to the monitoring slider.
5. **Low-E pitch detection speed vs. accuracy.** About 45 ms is needed to *know*
   the pitch. Timing comes from the onset detector, so this only affects
   *what* is judged, not *when*. Very fast 16ths on the E string are the hardest case.
6. **Windows audio processing.** Windows "audio enhancements" / communication
   ducking on the Real Tone Cable input can change the signal. The README will
   include the exact Windows settings to check.
7. **Monitoring latency.** Monitoring through the browser adds its own round trip (probably
   60–120 ms with a wireless headset). This is expected: the slider is meant for judging
   latency, not for playing.

---

## 9. Version 2 hooks designed in now

* `scoring/session.js` emits per-note results with `bar` + `section`, which is what
  IndexedDB stats and the weak-spots view need.
* Loop events plus a per-pass accuracy number drive auto speed-up later.
* Wait mode uses `adapter.pause()` + the matcher's "next expected note" state.
* Recording: the input graph already has a tap point for a `MediaRecorder`.
