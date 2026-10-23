// Service worker: update checks, opening the updater page, and reloading
// Songsterr tabs after an update so they pick up the new code.
import { fetchLatest, compareVersions } from './src/core/updater.js';

const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

async function checkForUpdate(force = false) {
  const current = chrome.runtime.getManifest().version;
  const { updateCheck } = await chrome.storage.local.get('updateCheck');
  if (!force && updateCheck && Date.now() - updateCheck.at < CHECK_EVERY_MS && updateCheck.current === current) {
    return updateCheck;
  }
  try {
    const latest = await fetchLatest();
    const result = {
      at: Date.now(),
      current,
      latest: latest.version,
      available: compareVersions(latest.version, current) > 0,
      commitMessage: latest.commitMessage,
      commitDate: latest.commitDate,
    };
    await chrome.storage.local.set({ updateCheck: result });
    return result;
  } catch (err) {
    return { at: Date.now(), current, available: false, error: String(err.message || err) };
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === 'checkUpdate') {
    checkForUpdate(!!msg.force).then(sendResponse);
    return true; // async response
  }
  if (msg && msg.type === 'openUpdater') {
    chrome.runtime.openOptionsPage();
  }
  return false;
});

chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason !== 'update') return;
  // Old content scripts in open Songsterr tabs are cut off from the new
  // version; reload those tabs so the new version starts there.
  try {
    const tabs = await chrome.tabs.query({ url: 'https://www.songsterr.com/*' });
    for (const t of tabs) chrome.tabs.reload(t.id);
  } catch { /* not critical */ }
});
