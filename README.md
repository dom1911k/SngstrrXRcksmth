# Bass Trainer for Songsterr

A Rocksmith-style practice tool for bass that runs inside Chrome on top of
[Songsterr](https://www.songsterr.com). It listens to your bass through the
Rocksmith Real Tone Cable, and (when finished) shows a note highway for the
song and scores what you play.

**Current version: 0.6.0.** Rocksmith 2014-style **3D note highway** in sync with
Songsterr's player, **scoring** of what you play (accuracy, streak, summary),
**practice tools** (riff repeater with automatic speed-up, wait mode, practice
history with your weak spots, recording takes and listening back, automatic bass
muting, count-in, keyboard / foot-pedal shortcuts), a **standalone player** for
your own chart + audio file, a tuner that follows the tab's tuning, latency
calibration and monitoring.

It only uses what your Songsterr account already shows you in the browser.
It does not unlock anything.

---

## 1. One-time Windows setup (5 minutes)

Do this once, with the Real Tone Cable plugged in.

1. **Close Rocksmith** and any music software. They can hold the cable exclusively.
2. Open **Start → Settings → System → Sound**.
3. Under **Input**, click the cable (usually called *Rocksmith Guitar Adapter* or
   *Microphone (Rocksmith USB Guitar Adapter)*):
   - **Input volume**: start around **70**. You'll fine-tune it later with the trainer's meter.
   - **Audio enhancements**: **Off** (if the option is there).
4. Scroll down to **More sound settings** → tab **Communications** → select
   **Do nothing**, then OK. (Otherwise Windows may turn things down when it thinks you're on a call.)
5. In **More sound settings** → tab **Recording** → right-click the cable →
   **Properties** → tab **Listen** → make sure **Listen to this device** is
   **unchecked**. The trainer has its own monitoring slider, and having both on
   gives you an echo.
6. Headphones: set the Razer BlackShark V3 (2.4 GHz dongle) as the default
   **Output**. If you use Razer Synapse, turning off **THX Spatial Audio**
   reduces delay.

## 2. Install the extension

You don't need Git or any programming tools.

1. Download the trainer as a ZIP:
   open <https://github.com/dom1911k/SngstrrXRcksmth/archive/refs/heads/claude/admiring-hopper-77heid.zip>
   while logged into GitHub. (Or, on the GitHub page, make sure the branch
   selector shows `claude/admiring-hopper-77heid`, then **Code → Download ZIP**.)
2. Make a **permanent folder** for it, for example `Documents\BassTrainer`.
   Extract the ZIP there. You'll have a folder with `README.md` and a folder
   called **`extension`** inside it.
3. In Chrome, open `chrome://extensions` (type it into the address bar).
4. Turn on **Developer mode** (switch at the top right).
5. Click **Load unpacked** and select the **`extension`** folder (the one that
   contains `manifest.json`).
6. "Bass Trainer for Songsterr" now appears in the list. Click the
   puzzle-piece icon in Chrome's toolbar and **pin** it. Clicking its icon opens
   the standalone player (see "Standalone player" below).

This is the only time you need to download a ZIP. Later versions install from
inside the extension (next section).

Chrome may sometimes show a notice about developer-mode extensions. That's normal
for extensions installed this way. Keep it enabled.

## 3. Updating (one click, from inside the extension)

The extension updates itself from GitHub. You don't need to download anything by hand.

**When there's a new version**, the Bass Trainer panel on Songsterr shows a yellow
bar **"Update available: 0.1.1 → 0.2.0"**, and the BASS TRAINER tab gets a red dot.
(It checks GitHub every few hours. You can also check any time: click the
extension's icon in Chrome's toolbar, then **Updates** at the top right of the player.)

1. Click **Update**. The update page opens.
2. **The first time only:** click **Choose extension folder…** and pick the
   **`extension`** folder you loaded in step 2 above (for example
   `Documents\BassTrainer\extension`). Chrome asks whether to let the extension
   edit files in it. Choose **Edit files**, and if offered, **Allow on every visit**.
3. Click **Update now**. It downloads only the changed files, restarts itself and
   reloads your Songsterr tabs. The panel then says "Updated to version …".

Your settings (input device, calibration, tuning) are kept.

Notes:
- If Chrome asks again for permission to edit the folder, click Allow. Chrome
  sometimes asks again after a restart.
- The updater only writes inside the folder you chose, and only after checking
  that it really is this extension's folder.
- If an update fails, nothing is half-changed: all files are downloaded and checked
  before anything is written. **Re-download all files** on the update page repairs
  a broken install.
- Manual fallback: download the ZIP again (step 2), extract it **into the same folder**
  replacing the old files, then click **↻** on the Bass Trainer card in
  `chrome://extensions` and reload Songsterr.

## 4. Using it

### The note highway
Open a song on Songsterr and pick its **bass track**. If another track is
showing, the highway says so and offers a button for each bass track. Songs
without an electric bass but with a bass-range part, such as the *Contrabass* in
Good Riddance, can be played too.

- Press play in Songsterr as usual. The highway follows Songsterr's player exactly,
  including pause, seeking (clicking in the tab), loops and speed changes.
- It works with both of Songsterr's sound sources (**ORIG.** recording and
  **SYNTH**). To practise without the recorded bass, use Songsterr's mixer to
  mute the bass track in SYNTH mode. (Phase 4 does this automatically.)
- Layout, as in Rocksmith 2014 (3D view):
  - The fretboard lies in front of you, low on the screen, and the highway runs
    up to near the top of the screen. You see about 4.5 seconds ahead
    (adjustable). In full screen this shows the next few bars, as in Rocksmith.
  - **Colour and height = string:** E red (top), A yellow, D blue, G orange.
    Notes far away appear higher up and drop onto their string as they arrive.
  - **Left–right = fret,** numbered on the floor in front of the strings. The
    frets under your hand are yellow.
  - The lit lane on the floor shows where your hand should be (4 frets). A big
    yellow number in the distance marks where the hand moves next.
  - The camera frames only the frets the current passage uses; the rest of the
    neck is darkened. It stays still while you play a passage and only glides
    when the music moves to another part of the neck. For example, 21 Guns
    (frets 1–8) never moves the camera at all.
  - Play each note when it reaches the strings. A soft spot of light on the string,
    at the note's fret, grows brighter as the note comes in and flashes briefly
    at the exact moment to play. The string glows while the note sounds.
  - Coloured ribbons are held notes. A ribbon that bends sideways is a slide; a
    wavy ribbon is vibrato.
  - Wide bars are open strings. **X** = dead note; faded small notes = ghost notes;
    **H**/**P** = hammer-on/pull-off; **PM** = palm mute. Notes played together
    (chords, double stops) have a white frame around them.
- **Section strip** (top edge of the highway, like Rocksmith's phrase bar): one
  block per section of the song (Intro, Verse 1, …) with a white line where you
  are. Once you have practised, each block is coloured by how well you play it
  (green = good, yellow = so-so, red = needs work), and small red marks show the
  bars you miss most. **Click** a section to jump there, **double-click** to loop
  it. The yellow frame is the loop. It can be turned off under *Song & highway*.
- **Highway / Both / Tab** (bottom left of the highway) switches between highway
  only, highway under the tab, and tab only. In *Both* you can drag the top edge
  of the highway to resize it. Bigger is easier to read.
- **3D / 2D** switches between the Rocksmith-style 3D highway and the simpler,
  flat 2D one. 2D is used automatically if your PC can't do WebGL.

Settings in the panel, under **Song & highway**:
- **Highway timing:** with a wireless headset the sound reaches you a bit after
  the picture. Play a song and move this slider until notes cross the strings
  exactly when you **hear** them. 40–120 ms is typical.
- **Note speed:** how many seconds ahead you see (default 4.5 s). Higher = you
  see further ahead and notes move more slowly.
- **Fret numbers on the notes (3D):** turn off for a cleaner, more Rocksmith-like look.
- **Tab order:** puts G on top, like a tab, instead of Rocksmith's E-on-top.
- **Download chart (JSON):** saves the song in the trainer's chart format
  ([`docs/CHART_FORMAT.md`](docs/CHART_FORMAT.md)) for use in other tools.

### Practice tools (panel → **Practice**)
- **Mute the song's bass track while the input is on:** when you click *Start
  input*, the trainer mutes Songsterr's bass track so you only hear your own bass,
  and turns it back on when you stop (or leave the page). This uses Songsterr's own
  mute button, so it needs **Songsterr Plus** and the **SYNTH** sound (the ORIG.
  recording can't be split into instruments). The panel says if it can't mute.
  If you turn the bass back on yourself while playing, it stays on.
- **Count-in** before playback and before each loop restart (on by default).
  On Songsterr this switches Songsterr's own count-in on; the highway shows
  "Count-in…" and waits. The standalone player clicks one bar at the song's tempo.
- **Shortcuts** (keyboard or foot pedal; section *Shortcuts*, folded by default):

  | Action | Default keys |
  |---|---|
  | Play / pause | Space |
  | Restart (song or loop start) | Home, R |
  | Loop start at the current bar | A |
  | Loop end at the current bar (loops from the start bar) | B |
  | Clear loop | C |
  | Slower / faster (5 % steps) | Num − / Num + (also - and =) |
  | Switch Highway / Both / Tab | V |
  | Loop the current section | L |
  | Wait mode on / off | W |
  | Riff repeater on / off | (none; set one if you like) |
  | Record takes on / off | (none) |

  To use a **foot pedal**: most pedals type a key (often Page Down / Page Up or an
  arrow). Click **Set** next to an action and step on the pedal; done. **+** adds a
  second key for the same action. A short message on the highway confirms each
  action ("Loop: bars 12–14", "Speed 85%"). Shortcuts work while the Songsterr page
  (or player) has focus, so click on the page once if the panel's slider has focus.

Panel sections can be folded by clicking their heading; the panel remembers it.

### Riff repeater, wait mode, weak spots, takes (panel → **Riff repeater & wait mode**)
These need the input to be running (*Start input*).

- **Loop this section** loops the section you are in (also: key **L**, or
  double-click it in the section strip).
- **Riff repeater:** tick *speed up automatically on a loop*. When you set a loop,
  the song drops to the start speed (default 70%). Each time you play a whole
  loop pass with at least the target accuracy (default 90%), the speed goes up by
  the step (default 5%), up to the maximum (default 100%). A pass you started in
  the middle of the loop doesn't count. The highway shows e.g. "93% · speeding up
  to 80%", or what you still need. All four numbers can be changed in the panel.
- **Wait mode** (button, or key **W**): the song stops at each note, with the note
  waiting on the strings and a box saying what to play ("Play C2 · fret 3 on the A
  string"). Play it and the song continues to the next note. A wrong note is shown
  ("you played E2") and it keeps waiting. Press play to skip a note. Nothing is
  scored in wait mode and the count-in is off meanwhile. Turning it off tells you
  how many notes you got right the first time.
- **Weak spots** (button): your progress for this song: number of passes, best
  score at full speed, accuracy per day, every section with its accuracy and a
  **Loop** button, and the bars you miss most with **Loop ±1 bar** and **Riff
  repeater** buttons (loops that bar and starts the riff repeater). Recent passes
  count more, so bars you have fixed drop off the list.
  Every scored pass is saved automatically: the whole song, each loop pass, and
  the part you played before you jumped somewhere else (at least 12 notes). The
  history is kept in Chrome (in the extension, so clearing Songsterr's site data
  doesn't delete it) and is shared between Songsterr and the standalone player.
  *Delete history of this song* clears it.
- **Record & listen back** (section folded by default): tick *Record takes*.
  Every run from play to pause, seek or loop restart becomes a **take** (the last
  6 are kept). **▶ Play** starts the song just before the take, at the speed you
  played it, with your recorded bass in time with the song (the latency
  correction is applied, so it sounds the way you played it to what you heard).
  The Songsterr bass stays muted if auto-muting is on, so you hear yourself instead
  of the tab. **Save** downloads the take as a WAV file. Takes disappear when the
  page is reloaded. *Take volume* sets how loud the take plays.

### Scoring
1. Open the BASS TRAINER panel and click **Start input** (the cable must be
   running). Calibrate once if you haven't.
2. Press play and play along. Above the highway you see a small accuracy % and your
   streak (can be hidden). There are no hit/miss markers on the notes.
3. **End of the song:** a summary with accuracy, early/on time/late/missed counts,
   **why** notes were missed (not heard / right note but too early or late /
   different note), your average timing, the bars to practise, and notes you
   played differently from the tab ("played D2 instead of C2 ×3 in bar 15"). If
   it's the same every time and you're sure, the tab may be wrong there.
4. **Loops:** each pass through a loop is scored separately, with a short pop-up
   after each pass (**Details** opens the full summary).
5. **Timing:** the trainer learns small, constant early/late offsets while you
   play (*automatic timing correction*), so correctly played notes aren't
   lost to latency. The learned value is shown in the panel's calibration section,
   with a Reset button. It resets when you calibrate again.

Settings (panel, **Song & highway → Scoring**): scoring on/off, live accuracy on/off,
automatic timing correction on/off, timing window (Strict ±70 / Normal ±110 /
Relaxed ±160 ms), dead notes (any muted attack counts, or not scored), and
"Show summary of the current pass".

Not scored by design: ghost notes; slide destinations that aren't picked again;
upper notes of chords. A note that keeps ringing never counts twice; you have to
play it again. Soft plucks with hardly any attack still count if the pitch is
right. Details: [`docs/SCORING.md`](docs/SCORING.md).

### Standalone player (your own audio)
Click the extension's icon in Chrome's toolbar, or **Open standalone player** in the
panel. A page opens where you can practise without Songsterr:

1. **Open chart…** loads a bass chart (.json in the [chart format](docs/CHART_FORMAT.md)).
   It can come from your own tool, or from **Download chart (JSON)** on Songsterr.
2. **Open audio…** loads the song (MP3, OGG, WAV, M4A, FLAC). You can also drag
   both files onto the page.
3. Press **▶** (or Space). Speed changes keep the pitch. **A** / **B** set a loop
   (or `[` and `]`), **✕** clears it, and ← / → jump 5 seconds.
4. If the notes are consistently early or late compared with the recording, change
   **Audio offset** (in ms) until they line up. This happens when the chart's bar 1
   doesn't start exactly where the audio file starts.

The tuner, calibration and highway settings are the same as on Songsterr (open
the BASS TRAINER tab on the right). Chrome asks once more for microphone access,
because the player is a separate page. Without an audio file, the chart plays silently.

### Starting the input

1. Open any tab on songsterr.com (or the standalone player).
2. Click the yellow **BASS TRAINER** tab on the right edge of the page.
3. Click **Start input**. The first time, Chrome asks to use your microphone for
   songsterr.com: click **Allow**. (The Real Tone Cable counts as a microphone.)
4. If the list doesn't show the cable, choose it there. The trainer remembers your choice.

### Input level
Pluck hard. The meter's white peak line should reach the yellow area, peak
around **-20 to -6 dBFS**. If you see **Clipping!**, lower the cable's input
volume in Windows sound settings. If peaks stay below about -30, raise it.

The line under the meter should say **voice processing off**. That confirms
Chrome is not applying echo cancellation, noise suppression or auto gain to
your bass.

### Tuner
Pick your target tuning (E Standard by default) and play **open strings** one
at a time. The large letter is the note you're playing. The needle shows how far
off you are from the nearest string of the target tuning. It turns green within
±3 cents. If a string is noticeably off for a while, a ⚠ warning tells you which
one and by how much (for example "about a half step down").

When a bass track is open, the target tuning switches to **From tab** automatically.
If your bass doesn't match it, the ⚠ warning says which string is off.

### Latency calibration (do this before scoring)
Everything you play reaches the computer a little late: the wireless headset
delays what you hear, then the cable and the pitch detector add their own delay.
Calibration measures this total once so all timing judgments are fair.

1. Put on your headphones and click **Calibrate**.
2. Listen to 4 clicks. Then pluck one short note (an open string is fine)
   **on each of the next 16 clicks**, timed to what you hear.
3. The result is saved as **Total latency** (typically 60–200 ms with a wireless
   headset). The **±** number is how consistent you were: under ±12 ms is good.

Re-run calibration if you change headphones, use a different USB port, or the
timing feels off. **Fine-tune** lets you nudge it by hand: if correct notes are
judged "late", move the slider right; if "early", move it left.

### Monitoring (hearing yourself)
The **Hear yourself** slider (off by default) sends your bass to the headphones
through the browser. You'll hear a clear delay. That's the real latency, and it's
why the trainer compensates for it. It's useful for checking the signal, not for
playing along. For playing, use an amp or the cable's direct sound if you have one.

### Reducing delay

There are two different delays. It helps to keep them apart:

- **Scoring delay:** fully corrected by calibration. You don't need to do
  anything except calibrate once. The *Fine-tune* slider only affects scoring
  (from Phase 3 on) and **does not change what you hear**. Leave it at 0 for now.
- **What you hear while monitoring:** cannot be corrected, only reduced. The sound
  travels cable → Windows → Chrome → 2.4 GHz dongle → headset, and every step
  adds a few milliseconds. Through a browser and a wireless headset, roughly
  40–80 ms is normal. That's just enough to feel "a tiny bit after I play".

To make the monitoring delay as small as possible:

1. **Same sample rate on both devices (most important).** The cable runs at
   48 kHz. In Windows: **Settings → System → Sound → (your headset under
   Output) → Output settings / Format** → **48000 Hz** (16 or 24 bit). Do the same
   for the cable under Input if it offers a choice. If the rates differ, the
   panel shows a warning, because Chrome then has to convert between them.
2. Keep **Smallest audio buffer** (Monitoring section) ticked. Untick it only if
   you hear crackling.
3. Headset: use the **2.4 GHz dongle, never Bluetooth** (Bluetooth adds 150 ms+).
   Plug the dongle directly into the PC, not a hub. If your headset has a
   USB-cable (wired) mode, that is faster still.
4. Turn off extra processing on the headset: **THX Spatial Audio** / EQ in Razer
   Synapse, and **Spatial sound** + **Audio enhancements** in Windows for the
   headset.
5. Close other audio programs (Discord, DAWs, Rocksmith).
6. After changing any of these: click **Stop input** → **Start input** (or reload the page),
   then **re-run the calibration**.

**Zero delay:** hear your bass *directly* instead of through the computer, and
leave monitoring at 0. For example, use an amp or a bass headphone amp fed from a
passive splitter/Y-cable, with the second output going into the Real Tone Cable.
This is how Rocksmith players avoid lag too. The trainer only needs the cable signal
for detection.

## 5. Troubleshooting

| Problem | Fix |
|---|---|
| No "BASS TRAINER" tab on Songsterr | Check that the extension is enabled in `chrome://extensions`, then reload the Songsterr tab. |
| "Microphone access was blocked" | Click the mic/settings icon at the left of the address bar → allow Microphone for songsterr.com → press Start input again. |
| "The input is busy" | Close Rocksmith, a DAW, Discord voice, etc., then try again. Unplug/replug the cable if needed. |
| Meter moves but tuner shows nothing | Pluck harder or raise the Windows input volume. Make sure you picked the cable, not the headset mic. |
| "This input does not look like the Real Tone Cable" | Pick the cable in the device list (its name contains *Rocksmith*). |
| Calibration says "Only N of 16 notes were detected" | Play one clear note per click, and check the level meter. Very quiet or muted plucks are missed. |
| Calibration number seems wrong (negative, or above 350 ms) | Run it again, playing to the clicks you hear, not ahead of them. |
| Highway says "Looking for the Songsterr player…" for a long time | Reload the page. If it stays, Songsterr probably changed their site and the adapter (`extension/src/adapters/songsterr/`) needs an update. Please report it. |
| Highway shows "not a bass part" | Click one of the offered bass tracks, or pick it in Songsterr's track list. |
| Notes reach the strings before/after you hear them | Adjust **Highway timing** in the panel (Song & highway). |

## Roadmap

- **Phase 1 (done):** cable input, tuner, monitoring, latency calibration.
- **Phase 2 (done):** read the song from Songsterr, chart format, Rocksmith-2014-style
  note highway synced to Songsterr playback (play, pause, seek, loop, speed).
- **V3 (done, 0.3.0):** 3D Rocksmith-style highway with a camera following the hand
  position, and a standalone player for chart files + local audio.
- **Phase 3 (done, 0.4.0):** scoring: hit/miss, early/on time/late, accuracy, streak,
  summary, edge cases (dead notes, ghost notes, slides, ringing notes, octave errors).
- **Phase 4 (done, 0.5.0):** automatic bass-track muting, count-in, configurable
  keyboard / foot-pedal shortcuts, cleaner highway with a subtle hit indicator.
  0.5.1: Rocksmith-like camera: strings low on screen, longer view ahead.
- **V2 (done, 0.6.0):** riff repeater with automatic speed-up, wait mode, practice
  history with weak spots and a section strip on the highway, recording takes and
  playing them back with the song. Highway: chord frames, vibrato tails, horizon glow.

Design details are in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## For developers

No build step: the `extension/` folder is loaded as-is. Tests use Node 20+:

```
node --test tests/*.test.mjs                      # DSP, logic and updater unit tests
node tests/make-wav.mjs /tmp/a.wav                # synthetic bass recording
node tests/e2e-phase1.mjs /tmp/a.wav shot.png     # Chromium + fake mic (needs Playwright)
node tests/e2e-phase2.mjs [tab-url] [shot-prefix] # real Songsterr: highway sync (needs network)
node tests/e2e-player.mjs /tmp/a.wav [shot.png]   # standalone player: chart + audio, speed, loop
node tests/e2e-scoring.mjs [shot.png]             # scoring in the browser with a synthesized performance
node tests/e2e-phase4.mjs /tmp/a.wav [shot.png]   # real Songsterr: count-in, shortcuts, mute status
node tests/e2e-v2.mjs [shot-prefix]               # takes, history + progress card, wait mode, riff repeater
npx http-server -p 8123                           # then open /tests/highway-preview.html?t=78&style=3d
```

The 3D highway uses [three.js](https://threejs.org) r170 (MIT), bundled unmodified in
`extension/vendor/three/`.

```
```

### Releasing an update
Bump `"version"` in `extension/manifest.json` and push to the repository's default
branch. Installed copies see the higher version and offer the update. Only files
under `extension/` are synced.
