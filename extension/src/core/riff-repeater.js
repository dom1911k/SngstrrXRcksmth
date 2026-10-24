// Riff repeater: loop a section and speed it up automatically. Each complete
// loop pass that reaches the target accuracy raises the speed by one step
// (e.g. start 70%, +5% at 90%+), up to the maximum. Uses the loop-pass
// summaries of the ScoringSession, so the input has to be on.

import { getSettings, updateSettings, onSettingsChange } from './settings.js';
import { sectionsOf } from './history.js';
import { nextPracticeRange } from './phrases.js';

// Pure decision for one finished loop pass (exported for tests).
// Speeds in percent. Returns { speed, action: 'up' | 'stay' | 'mastered' }.
export function nextRiffSpeed({ accuracy, speedPct, target = 90, step = 5, max = 100 }) {
  const reached = accuracy !== null && accuracy * 100 >= target - 1e-9;
  if (!reached) return { speed: speedPct, action: 'stay' };
  if (speedPct >= max - 0.5) return { speed: speedPct, action: 'mastered' };
  return { speed: Math.min(max, speedPct + step), action: 'up' };
}

// The section (by the chart's section markers) around song time t.
export function sectionAt(chart, t) {
  const list = sectionsOf(chart);
  let cur = list[0] || null;
  for (const s of list) { if (s.t <= t + 1e-3) cur = s; else break; }
  return cur;
}

export class RiffRepeater {
  constructor(adapter, session, { notify = () => {} } = {}) {
    this.adapter = adapter;
    this.session = session;
    this.notify = notify;
    this.status = '';
    this.passes = 0;
    this.lastLoopKey = '';
    this.listeners = new Set();
    session.on('summary', (s) => { if (s.kind === 'loop') this.onLoopPass(s); });
    adapter.on('loop', (st) => this.onLoopChange(st));
    onSettingsChange((s) => {
      if (s.riffRepeater !== this.enabled) {
        this.enabled = s.riffRepeater;
        if (this.enabled) this.begin(); else this.setStatus('');
      }
    });
    this.enabled = getSettings().riffRepeater;
  }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  setStatus(text) {
    this.status = text;
    for (const fn of this.listeners) fn(text);
  }

  opts() {
    const s = getSettings();
    return { start: s.rrStartSpeed, step: s.rrStep, target: s.rrTarget, max: s.rrMaxSpeed };
  }

  // Start (again) at the start speed on the current loop.
  begin() {
    const st = this.adapter.getState();
    if (!st.ready || !st.loop) {
      this.setStatus('Set a loop ("Loop this phrase", "Loop this section" or A/B) and the riff repeater starts.');
      return false;
    }
    const { start } = this.opts();
    this.passes = 0;
    this.lastLoopKey = `${st.loop.start.toFixed(3)}-${st.loop.end.toFixed(3)}`;
    this.adapter.setSpeed(start);
    this.setStatus(`Riff repeater: ${start}%. Reach ${this.opts().target}% in a loop pass to speed up.`);
    this.notify(`Riff repeater: ${start}%`);
    return true;
  }

  onLoopChange(st) {
    if (!this.enabled || !st || !st.loop) return;
    const key = `${st.loop.start.toFixed(3)}-${st.loop.end.toFixed(3)}`;
    if (key !== this.lastLoopKey) this.begin();
  }

  onLoopPass(s) {
    if (!this.enabled) return;
    const st = this.adapter.getState();
    if (!st.loop) return;
    // Only complete passes count (not one started in the middle of the loop).
    if (s.from > st.loop.start + 0.3) return;
    this.passes++;
    const speedPct = Math.round((st.speed || 1) * 100);
    const o = this.opts();
    const r = nextRiffSpeed({ accuracy: s.accuracy, speedPct, target: o.target, step: o.step, max: o.max });
    const acc = s.accuracy === null ? '–' : `${Math.round(s.accuracy * 100)}%`;
    if (r.action === 'up') {
      this.adapter.setSpeed(r.speed);
      this.notify(`${acc} · speeding up to ${r.speed}%`);
      this.setStatus(`Riff repeater: ${r.speed}% (last pass ${acc}).`);
    } else if (r.action === 'mastered') {
      const next = getSettings().rrAdvance ? nextPracticeRange(this.adapter.getChart(), st.loop) : null;
      if (next) {
        // Phrase ladder: on to the next phrase (or the whole section), from the start speed.
        this.notify(`${acc} at ${speedPct}% · mastered! Next: ${next.label}`);
        this.adapter.setLoop(next.t, next.end);
        this.adapter.seek(next.t);
        return;
      }
      this.notify(`${acc} at ${speedPct}% · mastered!`);
      this.setStatus(`Mastered at ${speedPct}%. Pick the next section, or keep polishing.`);
    } else {
      this.notify(`${acc} · ${o.target}% needed for ${Math.min(o.max, speedPct + o.step)}%`);
      this.setStatus(`Riff repeater: ${speedPct}% (last pass ${acc}, need ${o.target}%).`);
    }
  }
}

// Loop the section that is playing now (by section markers).
export function loopCurrentSection(adapter, notify = () => {}) {
  const chart = adapter.getChart();
  if (!chart || !chart.bars.length) return null;
  const sec = sectionAt(chart, adapter.getTime());
  if (!sec) return null;
  adapter.setLoop(sec.t, sec.end);
  notify(`Loop: ${sec.name} (bars ${chart.bars[sec.firstBar].measure + 1}–${chart.bars[sec.lastBar].measure + 1})`);
  return sec;
}

// Loop a range of bars (indices into chart.bars), e.g. a weak spot.
export function loopBars(adapter, firstBar, lastBar, notify = () => {}) {
  const chart = adapter.getChart();
  if (!chart || !chart.bars[firstBar]) return;
  const a = chart.bars[firstBar], b = chart.bars[Math.min(lastBar, chart.bars.length - 1)];
  adapter.setLoop(a.t, b.end);
  adapter.seek(a.t);
  notify(firstBar === lastBar ? `Loop: bar ${a.measure + 1}` : `Loop: bars ${a.measure + 1}–${b.measure + 1}`);
}
