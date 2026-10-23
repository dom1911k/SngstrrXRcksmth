// Entry point, loaded by content/loader.js on songsterr.com pages.
import { loadSettings, onSettingsChange } from './core/settings.js';
import { AudioEngine } from './audio/engine.js';
import { createPanel } from './ui/panel.js';

export async function start() {
  if (document.getElementById('bass-trainer-root')) return; // already running
  await loadSettings();
  const engine = new AudioEngine();
  const panel = createPanel(engine);
  document.documentElement.append(panel.host);
  // Exposed for troubleshooting from the DevTools console (isolated world).
  globalThis.bassTrainer = { engine, panel, onSettingsChange };
  return { engine, panel };
}
