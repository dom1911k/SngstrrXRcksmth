# Bass Trainer for Songsterr: Architecture Proposal

Status: **V2 built (0.6.0)**: riff repeater, wait mode, practice history with
weak spots and a section strip, takes (see §12). **Phase 4 (0.5.x)**: auto bass muting (`core/auto-mute.js`, Songsterr's
`controls/mute`), count-in (Songsterr's own count-in; the player's own clicks),
configurable shortcuts (`core/shortcuts.js`, window capture phase, `KeyboardEvent.code`
bindings), highway clean-up with a hit indicator. **Correction:** Songsterr's
`isCountin` is the count-in *setting*; "counting now" is detected as "play pressed
but the position doesn't move". Phase 3 (0.4.x): scoring (see `docs/SCORING.md`). Also built:
**V3 (0.3.x)**: 3D Rocksmith-style highway and standalone player, on
top of Phase 2 (Songsterr adapter, chart format, highway in sync).
Phase 1 (input, tuner, monitoring, calibration) and self-update are done too. This file
is the design reference for all phases and is kept up to date.

## 0. Decisions (from the owner, October 2026)

| Question | Decision |
|---|---|
| Highway look | Mirror **Rocksmith 2014** as closely as possible in 2D: notes approach from the distance down a perspective highway toward the fretboard at the bottom, horizontal position = fret, lane/colour = string, fret numbers on gems, sustain tails, highlighted anchor (hand-position) zone, low E drawn at the top as in Rocksmith's default (an "invert strings" option for tab order). The 3D version (V3) keeps the same layout with a real camera. |
| String colours | Rocksmith 2014: E red, A yellow, D blue, G orange. 5-string low B: green (Rocksmith bass has no 5th colour). |
| Dead notes (x) | Any muted attack in the window counts as a hit. |
| Updating | One-click self-update from inside the extension (see §10). Manual ZIP install only the first time. Manifest has a fixed `key` so the extension ID (and saved settings) survive moving the folder. |
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
| App state | Preact 10 with Songsterr's own store (`get()`, `dispatch(event, payload)`, `on`, `subscribeWithSelector`). In production it is **not** exposed on `window` (`window.__store__` is only set on non-prod builds). *Verified in Phase 2:* it is passed as `props.store` to top-level components (`AppErrorBoundary`, `CursorProvider`, …) and found by walking `#root.__k`. | The adapter must find the store through Preact's component tree. This is the most fragile part, and all of it stays inside `adapters/songsterr/`. |
| Playback position | *Verified in Phase 2:* `state.player.instance.getCursor()` returns the play position in **tab milliseconds**. It works for both the synth `AudioPlayer` and the original-recording video player (which maps video time through per-bar `videoPoints`/`audioPoints`). It advances smoothly in real time × speed, jumps on seek, and wraps at loop end. `state.cursor.position = {cursor, loopStart, loopEnd}`. `state.player.speed` (%), `shouldPlay`, `isCountin`. | We read the exact player clock every animation frame. Measured sync error between overlay and player: < 0.5 ms through play/seek/speed/loop/pause. |
| Beat timing | `state.part.current.timestamps[]`: one tab-ms time per **beat layout** (`measures[].beatsLayouts[]`) in playback order. It already includes tempo changes and gradual (linear) tempo changes. `state.playings.metronomeTimeline[]`: beats with `timestamp`, `beatNum`, `bpm`. Repeat fields on measures: `repeatStart`, `repeat` (play count on the closing bar), `alternateEnding: [passes]`. | The converter uses Songsterr's own times instead of recomputing tempo, and only interpolates inside a bar. It checks that the repeat-expanded beat-layout count equals `timestamps.length`. |
| Tracks | Each track: `partId`, `instrument`, `tuning` (MIDI, **highest string first**), `isBassGuitar`. Track URLs: `…-s{songId}t{partId}` redirects to that track. Good Riddance has no bass guitar but a **Contrabass** track in E A D G. | "Bass-like" = bass guitar, or a non-drum track whose lowest string ≤ A1. The highway offers a switch button when another track is shown. |
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
    history.js, history-db.js  practice history (IndexedDB) and weak-spot statistics
    riff-repeater.js      loop a section, automatic speed-up
    wait-mode.js          stop at each note until it is played
    takes.js              record takes, play them back in sync, WAV export
    practice-tools.js     wires the four above (Songsterr and player)
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

* **One clock.** Each animation frame the page bridge samples
  `player.instance.getCursor()` together with `performance.now()` and posts it
  to the extension. `core/clock.js` extrapolates at `speed` between samples. Small
  differences are slewed out (15% per frame); differences over 50 ms (seek, loop
  restart, buffering) snap to the player. So the highway resyncs instead of drifting.
* **Visual delay.** What you hear lags the player position by the output
  latency (Chrome buffer + wireless headset). The highway therefore shows
  `cursor − visualDelay × speed`. "Highway timing" in the panel defaults to 60 ms.
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
  Runs on a 4× decimated signal (~12 kHz, 2 kHz anti-alias low-pass). The
  autocorrelation is computed by FFT (0.3.1): identical results, ~2.8× less CPU on
  the audio thread than the direct sum. The window
  is two periods of the lowest expected note (two semitones below the lowest
  string): ≈53 ms for E Standard, ≈71 ms for 5-string B. Hop ≈5 ms.
  Tested: within 2 cents on synthetic E1–G4 plucks at 44.1/48 kHz; low E locks
  within 80 ms of the attack; weak-fundamental low E has no octave error.
* Pitch is reported per onset as "the stable pitch in the first 30–80 ms
  after the onset". Timing comes from the onset, not from when pitch locked.
* The tuner uses the same detector with a longer window and smoothing,
  aiming for ±2 cents vs. a hardware tuner.

---

## 7. Scoring edge cases (initial policy; the implemented rules are in `docs/SCORING.md`)

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
2. ~~Units of the player clock and the playback timeline~~. **Resolved in Phase 2:**
   `getCursor()` is in tab ms, the same unit as `part.timestamps`. Repeats are handled
   and checked against Songsterr's timeline. None of the 3 test songs (and none of
   9 popular bass tabs checked) actually uses repeat signs.
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

## 9. Version 2 hooks (designed up front; built in 0.6.0, see §12)

* `scoring/session.js` emits per-note results with `bar` + `section`, which is what
  IndexedDB stats and the weak-spots view need.
* Loop events plus a per-pass accuracy number drive auto speed-up.
* Wait mode uses `adapter.pause()` + the scorer's list of scorable notes.
* Recording: a second worklet processor taps the input (instead of a
  `MediaRecorder`, so every sample has an exact AudioContext time).

---

## 10. Self-update

Chrome can't replace an unpacked extension by itself, and installing a self-hosted
`.crx` on Windows needs enterprise policy. So the extension updates its own files
on disk:

* `background.js` (service worker) checks GitHub every 6 h when the Songsterr panel
  opens: `GET /repos/…` (default branch), then `/commits/{branch}`, then
  `extension/manifest.json` at that commit. No token is needed because the repository is public.
* If the remote `version` is higher, the panel shows an **Update** bar, which opens
  `updater/updater.html` (also the toolbar button and the options page).
* The updater page keeps a File System Access directory handle to the
  extension folder in IndexedDB. The user picks it once, and it is verified by
  `manifest.json` name + `key`.
* `applyUpdate` compares each file's git blob SHA-1 with the tree and downloads only
  the changed files from `raw.githubusercontent.com` at the exact commit. It verifies
  their hashes and **writes nothing unless every download succeeded**. It writes
  `manifest.json` last and removes files that an earlier update installed but that
  are gone upstream. User files are never touched.
* Then `chrome.runtime.reload()`. `onInstalled(reason: 'update')` reloads open
  Songsterr tabs, and the panel shows "Updated to version …".
* Releasing = bump `manifest.json` version and push to the default branch.

---

## 11. V3: 3D highway and standalone player

**3D highway** (`ui/highway3d.js`, three.js r170 vendored in `extension/vendor/three/`):
* World: x = frets (1 unit each, nut at 0), y = up (floor at 0, strings stacked
  above it, low E on top), z = time (strike line at z = 0, the future at −z).
  40 world units ≙ the look-ahead (default 4.5 s of real time, × speed in song time).
* Static scene: floor, fret wires, fret numbers, strings (glow while a note sounds).
* `timeGroup` holds everything that is a length in time (beat/bar lines, anchor
  lanes with their "next fret" labels, sustain/slide ribbons). It is built once in
  seconds and moved/scaled each frame (`position.z = t·k`, `scale.z = k`).
  Clipping planes cut ribbons at the strike line.
* Gems (box, edges, glow sprite, stem to the floor, fret-number sprite, technique
  tag) are built once per note. Each frame only the notes inside the time window
  are positioned/shown (binary search), so the cost is independent of song length.
* Camera (`core/camera-follow.js`, unit tested, 0.3.2): the song is split into
  **passages** whose fretted notes fit in about 9 frets (short excursions are merged
  into a neighbour, and frames that contain each other are joined). The camera holds
  **completely still** during a passage and frames exactly its frets. It moves only
  between passages: it starts after the old passage's last note (at most 1.2 s ahead),
  uses a critically damped glide, and moves faster when the gap is short. Frets
  outside the frame are shaded and their numbers dimmed. Seeks snap. Open strings
  and ghost notes never move the camera. All three test songs fit a single frame,
  so the camera never moves in them. The same framing is used by the 2D view.
* Camera placement (0.5.1, `CAM` in `highway3d.js`): FOV 22°; the strike line sits
  at 82% down the view (`strikeNdc`) and the pitch is solved by bisection so the far
  end of the lane is near the top (`farNdc` 0.86), as in Rocksmith 2014. The camera
  distance comes from the frame width (`widthFactor`, `extraWidth`; aspect capped at
  1.9). Fog is set relative to the camera distance and covers only the last ~18% of
  the lane. `tests/highway-preview.html?cam=fov:20,strikeNdc:0.8` overrides `CAM`
  for tuning (`globalThis.__btCam`).
* Performance (0.3.1): beat/bar lines, anchor lanes and sustain ribbons are merged
  into ~8 meshes (was >1,000 objects for 21 Guns); stems share one geometry; fret
  labels re-colour only when the hand moves; nothing is redrawn while paused and
  unchanged; resolution drops automatically (pixel ratio 2 → 1.5 → 1) if the
  frame rate stays under ~50 fps for 2 s.
* Falls back to the 2D renderer when WebGL is unavailable. The setting
  `highwayStyle` ('3d' | '2d') chooses between them.

**Standalone player** (`player/player.html`, `src/player-main.js`,
`adapters/local/adapter.js`): implements the same adapter interface as the
Songsterr adapter. Time comes from an `<audio>` element (`preservesPitch`, `playbackRate`),
or from a virtual clock when there is no audio file, through the same `SongClock`
smoothing. Chart files are validated with `validateChart()`. *Audio offset* maps chart
t = 0 to an audio position. A/B loop is enforced in the adapter's frame tick. The
panel (tuner, calibration, highway settings) is reused unchanged. The toolbar icon opens the player.

### Other optimizations (0.3.1)
* Page bridge: while Songsterr is paused and nothing changes, it posts state
  4×/s instead of 60×/s (other page scripts listening to `message` events
  no longer get woken every frame).
* Panel: tuner, meter and needle only touch the DOM when a value changed.

---

## 12. V2 practice tools (0.6.0)

All four are wired by `core/practice-tools.js` (same on Songsterr and in the
player); UI in `ui/training-section.js` (panel) and `ui/progress-ui.js` (overlay).

* **Scoring session changes.** Scores only while active (input on, scoring on, not
  suspended); when it becomes active a new pass starts at the current position,
  so notes passed while the input was off are not misses. `suspend(reason, on)`
  (wait mode, take playback). Emits `'played'` (every detected note, with song
  time) and `'summary'` kind `'partial'` when you jump away after ≥ 12 judged
  notes. Summaries carry `speed`, `at` and `perBar`.
* **History** (`core/history.js`, `core/history-db.js`): one record per pass
  `{ songKey, kind, speed, accuracy, judged, hits, perBar: [[bar, hits, misses]], barCount, … }`.
  IndexedDB `bass-trainer` / store `passes` (index `song`) in the **extension's**
  origin: extension pages use it directly, content scripts go through the
  background service worker (`{ type: 'history', op, args }`). Max 500 passes per
  song. `songKey` = `songsterr:{songId}:{partId}` or `local:{artist}|{title}`.
  `aggregate()` → sections (from chart section markers, `sectionsOf`), per-bar miss
  rates (recency-weighted: weight halves every 20 passes; only records with the same
  bar count), weak bars (≥ 3 notes), per-day accuracy. Unit tested.
* **Section strip** (overlay, 18 px canvas at the top): sections coloured by
  accuracy, red marks for bars with ≥ 20% misses, loop frame, position line.
  Click = seek, double-click = loop the section.
* **Riff repeater** (`core/riff-repeater.js`): on a `'loop'` summary whose pass
  started at the loop start, `nextRiffSpeed()` (pure, tested) raises the speed by
  `rrStep` if accuracy ≥ `rrTarget`, up to `rrMaxSpeed`. A new loop range (or
  turning it on) sets `rrStartSpeed`. Also `loopCurrentSection`, `loopBars`.
* **Wait mode** (`core/wait-mode.js`): stops = the scorer's scorable notes
  (ghosts and slide arrivals skipped, lowest chord note). When the song reaches
  `note.t + visualDelay − 30 ms` it pauses and seeks to `note.t + visualDelay`, so
  the gem waits on the strings. A `'played'` event matching like the scorer
  (`pitchMatch`: ±50 cents, octave errors accepted, dead = any attack) resumes;
  pressing play skips; a user seek/loop restart continues from there (our own
  repositioning is ignored for 0.8 s). Count-in is suppressed meanwhile via
  `adapter.suppressCountIn(on)` (Songsterr: its count-in toggles, restored from our
  settings afterwards; player: a flag). Scoring is suspended.
* **Takes** (`core/takes.js`, `RecorderProcessor` in `audio/pitch-worklet.js`): while
  armed, the worklet posts 4096-sample chunks stamped with the AudioContext time of
  their first sample. A take = one stretch of uninterrupted playback (ends on pause,
  jump or speed change; ≥ 1.5 s); its samples are cut out of the chunks by context
  time. Mapping: sample at context time c belongs to song time
  `sRef + (c − cRef)·speed`, where `(cRef, sRef)` is refreshed every frame from the
  clock minus the total latency (same correction as scoring). Playback: an
  `AudioBufferSourceNode` in the engine's context started so that the take's
  sample for song time s is rendered when the player is at s
  (`takeOffsetFor`), resynced when off by > 30 ms (checked every 0.5 s), stopped on
  pause/jump/speed change. WAV export: 16-bit mono. Last 6 takes, in memory only.
* **Highway additions (0.6.0):** chord frames (white box around simultaneous notes on
  different strings, child of the first gem), wavy tails for vibrato, a soft
  additive horizon glow behind the far end of the lane.
* Tests: `tests/v2.test.mjs` (unit), `tests/e2e-v2.mjs` (player in Chromium with a
  fake microphone: take recorded and played back in sync, history saved, progress
  card, wait mode stop/resume, riff repeater speed-up).
