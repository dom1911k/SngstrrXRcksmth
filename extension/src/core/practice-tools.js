// The V2 practice tools, wired the same way on Songsterr and in the
// standalone player: practice history, riff repeater, wait mode, takes and
// the input check,
// plus their keyboard / foot-pedal actions.
import { getSettings, updateSettings } from './settings.js';
import { HistoryRecorder } from './history.js';
import { RiffRepeater, loopCurrentSection, loopBars } from './riff-repeater.js';
import { LibraryTracker } from './library.js';
import { WaitMode } from './wait-mode.js';
import { Takes } from './takes.js';
import { InputMonitor } from './input-monitor.js';
import { SessionReport } from './session-report.js';
import { SetlistRunner } from './setlist-runner.js';
import { DetectionLog } from './detection.js';
import { loopCurrentPhrase } from './phrases.js';

export function createPracticeTools(engine, adapter, session, notify) {
  const history = new HistoryRecorder(session);
  const riff = new RiffRepeater(adapter, session, { notify });
  const wait = new WaitMode(adapter, session, { notify });
  const takes = new Takes(engine, adapter, session, { notify });
  const monitor = new InputMonitor(engine, session);
  const detection = new DetectionLog(session);
  // "Practise bars 12–14" chosen on the Library page: loop them once the song is open.
  const library = new LibraryTracker(adapter, {
    onPending: (p) => {
      if (p.switchTrack !== undefined && adapter.switchTrack) { adapter.switchTrack(p.switchTrack); return; }
      if (p.loopBars) setTimeout(() => loopBars(adapter, p.loopBars[0], p.loopBars[1], notify), 800);
    },
  });
  const actions = {
    loopSection: () => loopCurrentSection(adapter, notify),
    loopPhrase: () => loopCurrentPhrase(adapter, notify),
    riffRepeater: () => {
      const on = !getSettings().riffRepeater;
      updateSettings({ riffRepeater: on });
      if (!on) notify('Riff repeater off');
    },
    waitMode: () => wait.toggle(),
    recordTakes: () => takes.setArmed(!takes.armed),
  };
  history.onSaved(async (rec) => {
    const e = await library.checkGoal(rec);
    if (e) notify(`🎯 Goal reached: ${Math.round(e.goal.accuracy * 100)}% at ${Math.round(e.goal.speed * 100)}%! Marked as Mastered.`);
  });
  const report = new SessionReport(engine, history);
  const setlist = new SetlistRunner(library);
  return { history, riff, wait, takes, monitor, detection, library, report, setlist, actions };
}
