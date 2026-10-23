// The V2 practice tools, wired the same way on Songsterr and in the
// standalone player: practice history, riff repeater, wait mode, takes and
// the input check,
// plus their keyboard / foot-pedal actions.
import { getSettings, updateSettings } from './settings.js';
import { HistoryRecorder } from './history.js';
import { RiffRepeater, loopCurrentSection } from './riff-repeater.js';
import { WaitMode } from './wait-mode.js';
import { Takes } from './takes.js';
import { InputMonitor } from './input-monitor.js';

export function createPracticeTools(engine, adapter, session, notify) {
  const history = new HistoryRecorder(session);
  const riff = new RiffRepeater(adapter, session, { notify });
  const wait = new WaitMode(adapter, session, { notify });
  const takes = new Takes(engine, adapter, session, { notify });
  const monitor = new InputMonitor(engine, session);
  const actions = {
    loopSection: () => loopCurrentSection(adapter, notify),
    riffRepeater: () => {
      const on = !getSettings().riffRepeater;
      updateSettings({ riffRepeater: on });
      if (!on) notify('Riff repeater off');
    },
    waitMode: () => wait.toggle(),
    recordTakes: () => takes.setArmed(!takes.armed),
  };
  return { history, riff, wait, takes, monitor, actions };
}
