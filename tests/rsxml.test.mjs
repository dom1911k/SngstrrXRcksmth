// 0.16: Rocksmith arrangement XML -> chart (testing a finished CDLC on the highway).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRocksmithXml, isRocksmithXml } from '../extension/src/core/rsxml.js';
import { validateChart } from '../extension/src/core/chart.js';

const XML = `<?xml version="1.0" encoding="utf-8"?>
<song version="8">
  <title>Yoake To Hotaru</title><arrangement>Bass</arrangement><songLength>12.000</songLength>
  <tuning string0="-2" string1="0" string2="0" string3="0" string4="0" string5="0" /><capo>0</capo>
  <artistName>Rokudenashi &amp; Co</artistName>
  <ebeats count="8">
    <ebeat time="0.500" measure="1" /><ebeat time="1.000" measure="-1" /><ebeat time="1.500" measure="-1" /><ebeat time="2.000" measure="-1" />
    <ebeat time="2.500" measure="2" /><ebeat time="3.000" measure="-1" /><ebeat time="3.500" measure="-1" /><ebeat time="4.000" measure="-1" />
  </ebeats>
  <sections count="2"><section name="intro" number="1" startTime="0.500" /><section name="chorus" number="1" startTime="2.500" /></sections>
  <levels count="2">
    <level difficulty="0"><notes count="1"><note time="0.500" string="0" fret="3" /></notes><chords count="0" /></level>
    <level difficulty="1">
      <notes count="5">
        <note time="0.500" string="0" fret="0" sustain="0.400" palmMute="1" />
        <note time="1.000" string="1" fret="5" sustain="0.200" linkNext="1" slideTo="7" />
        <note time="1.250" string="1" fret="7" sustain="0.500" />
        <note time="2.000" string="2" fret="7" hammerOn="1" />
        <note time="2.250" string="3" fret="0" mute="1" />
      </notes>
      <chords count="1">
        <chord time="2.500" chordId="0">
          <chordNote time="2.500" string="0" fret="5" sustain="1.000" />
          <chordNote time="2.500" string="1" fret="7" sustain="1.000" />
        </chord>
      </chords>
    </level>
  </levels>
</song>`;

test('rsxml: reads the hardest level, tuning, bars, sections and techniques', () => {
  assert.ok(isRocksmithXml(XML));
  assert.ok(!isRocksmithXml('{"format":"bass-chart"}'));
  const c = parseRocksmithXml(XML, 'arr_bass_RS2.xml');
  assert.deepEqual(validateChart(c), []);
  assert.equal(c.meta.artist, 'Rokudenashi & Co');
  assert.deepEqual(c.instrument.tuning, [26, 33, 38, 43]);   // Drop D
  assert.equal(c.notes.length, 6);   // 5 notes + 2 chord notes - 1 tied note
  const [first, slide, hopo, dead] = c.notes;
  assert.ok(first.flags.palmMute && first.midi === 26 && first.dur === 0.4);
  assert.deepEqual(slide.flags.slide, { type: 'shift', toFret: 7 });
  assert.equal(Math.round(slide.dur * 1000), 750);   // tied into the next note
  assert.ok(hopo.flags.hopo && dead.flags.dead);
  assert.deepEqual(c.notes.filter((n) => n.t === 2.5).map((n) => n.string), [0, 1]);
  assert.equal(c.bars.length, 2);
  assert.deepEqual(c.bars.map((b) => [b.t, b.end, b.section]), [[0.5, 2.5, 'Intro'], [2.5, 12, 'Chorus']]);
  assert.deepEqual(c.beats.filter((b) => b.downbeat).map((b) => b.t), [0.5, 2.5]);
  assert.equal(c.notes[c.notes.length - 1].bar, 1);
});
