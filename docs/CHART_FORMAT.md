# Bass chart format (version 1)

The trainer works only with this JSON format. The Songsterr adapter converts
Songsterr tabs into it. A chart can also be downloaded from the panel
(**Song & highway → Download chart (JSON)**). Later versions will load charts in
this format from other tools, together with a local audio file.

All times are **seconds at 100% speed** on the song's own timeline: `t = 0` is
the start of the first bar, and repeats are already written out (unrolled).

## Example

```jsonc
{
  "format": "bass-chart",
  "version": 1,
  "meta": {
    "title": "21 Guns",
    "artist": "Green Day",
    "track": "Mike Dirnt | Fender Precision Bass",      // optional
    "instrument": "Electric Bass (pick)",                // optional
    "source": { "type": "songsterr", "songId": 23557, "revisionId": 0, "partId": 5 }  // optional
  },
  "instrument": {
    "strings": 4,
    "tuning": [28, 33, 38, 43],   // MIDI note numbers, LOWEST string first (E1 A1 D2 G2)
    "frets": 24,
    "capo": 0
  },
  "duration": 325.44,
  "bars": [
    { "i": 0, "t": 0.0, "end": 3.288, "measure": 0, "sig": [4, 4], "bpm": 73, "section": "Intro" }
  ],
  "beats": [
    { "t": 0.0, "bar": 0, "downbeat": true },
    { "t": 0.822, "bar": 0, "downbeat": false }
  ],
  "sections": [
    { "name": "Intro", "t": 0.0, "end": 16.438 }
  ],
  "notes": [
    {
      "t": 41.188,          // start, seconds
      "dur": 0.75,          // length, seconds (tied notes already merged)
      "string": 1,          // 0 = LOWEST string
      "fret": 5,
      "midi": 38,           // tuning[string] + fret + capo (optional when loading; computed if missing)
      "bar": 13,            // index into "bars" (optional)
      "flags": {
        "dead": false,      // muted "x" note
        "ghost": false,     // ghost note (shown dimmed, not scored)
        "hopo": false,      // hammer-on / pull-off destination (no new pick attack)
        "slide": { "type": "shift", "toFret": 1 },   // or null
        "slideTarget": false, // destination of a legato slide (no new attack)
        "bend": false,
        "harmonic": false,
        "palmMute": false,
        "staccato": false,
        "accent": false,
        "letRing": false,
        "vibrato": false,
        "grace": false
      }
    }
  ]
}
```

## Field reference

| Field | Required | Meaning |
|---|---|---|
| `format` | yes | Always `"bass-chart"`. |
| `version` | yes | `1`. |
| `instrument.tuning` | yes | 4–6 MIDI numbers, lowest string first. E Standard = `[28,33,38,43]`, 5-string B = `[23,28,33,38,43]`. |
| `instrument.strings` | no | Must equal `tuning.length` if given. |
| `instrument.frets`, `capo` | no | Defaults 24 and 0. |
| `notes[].t`, `string`, `fret` | yes | See example. `string` 0 = lowest. |
| `notes[].dur` | no | Seconds; default 0. |
| `notes[].flags` | no | Missing flags default to `false` / `null`. |
| `beats` | no | Beat grid (highway lines, count-in, metronome). Strongly recommended. |
| `bars` | no | Bar starts; needed for per-bar stats and loop-by-bar. |
| `sections` | no | Named sections (Intro, Verse…); used for section looping. |
| `duration` | no | Computed from notes/bars if missing. |

### Slide types
`slide.type` keeps the source name. From Songsterr: `shift` (slide, then pick
the target note), `legato` (slide into the target without picking),
`intoFromBelow`, `intoFromAbove`, `outDownwards`, `outUpwards`. `toFret` is the
target fret (or an approximate one for slide-outs), or `null` if unknown.

### Hand positions
They are not stored; the trainer computes them from the notes (a 4-fret span,
Rocksmith style).

## Validation
`validateChart()` in `extension/src/core/chart.js` returns a list of readable
errors (empty = valid), and `normalizeChart()` fills defaults and sorts. A
loaded file must pass validation.
