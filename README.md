# Bass Trainer for Songsterr

A Rocksmith-style practice tool for bass that runs inside Chrome on top of
[Songsterr](https://www.songsterr.com). It listens to your bass through the
Rocksmith Real Tone Cable, and (when finished) shows a note highway for the
song and scores what you play.

**Current version: Phase 1.** Cable input, tuner, monitoring and latency
calibration. The note highway, scoring and Songsterr integration come in the
next phases (see [Roadmap](#roadmap)).

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
   the update page.

This is the only time you need to download a ZIP. Later versions install from
inside the extension (next section).

Chrome may sometimes show a notice about developer-mode extensions. That's normal
for extensions installed this way. Keep it enabled.

## 3. Updating (one click, from inside the extension)

The extension updates itself from GitHub. You don't need to download anything by hand.

**When there's a new version**, the Bass Trainer panel on Songsterr shows a yellow
bar **"Update available: 0.1.1 → 0.2.0"**, and the BASS TRAINER tab gets a red dot.
(It checks GitHub every few hours. You can also check any time by clicking the
extension's icon in Chrome's toolbar, which opens the update page.)

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

1. Open any tab on songsterr.com.
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

From Phase 2 on, the target tuning comes from the song's tab automatically.

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

## Roadmap

- **Phase 1 (this version):** cable input, tuner, monitoring, latency calibration.
- **Phase 2:** read the song from Songsterr, chart format, Rocksmith-2014-style
  note highway synced to Songsterr playback (play, pause, seek, loop, speed).
- **Phase 3:** scoring: hit/miss, early/on time/late, accuracy, streak, summary,
  edge cases (dead notes, ghost notes, slides, ringing notes, octave errors).
- **Phase 4:** automatic bass-track muting, count-in, configurable keyboard /
  foot-pedal shortcuts, polish.
- **Later:** riff repeater with auto speed-up, wait mode, practice stats, take
  recording (V2); 3D highway and local audio + chart files (V3).

Design details are in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## For developers

No build step: the `extension/` folder is loaded as-is. Tests use Node 20+:

```
node --test tests/*.test.mjs                      # DSP, logic and updater unit tests
node tests/make-wav.mjs /tmp/a.wav                # synthetic bass recording
node tests/e2e-phase1.mjs /tmp/a.wav shot.png     # Chromium + fake mic (needs Playwright)
```

### Releasing an update
Bump `"version"` in `extension/manifest.json` and push to the repository's default
branch. Installed copies see the higher version and offer the update. Only files
under `extension/` are synced.
