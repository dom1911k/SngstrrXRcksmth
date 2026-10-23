import {
  fetchLatest, compareVersions, verifyFolder, applyUpdate, saveFolderHandle, loadFolderHandle,
} from '../src/core/updater.js';

const $ = (id) => document.getElementById(id);
const own = chrome.runtime.getManifest();
let latest = null;
let busy = false;

function setStatus(text, cls = '') {
  $('status').className = cls;
  $('status').textContent = text;
}

async function ensurePermission(handle) {
  const opts = { mode: 'readwrite' };
  if ((await handle.queryPermission(opts)) === 'granted') return true;
  return (await handle.requestPermission(opts)) === 'granted';
}

async function showFolder() {
  const handle = await loadFolderHandle();
  if (!handle) {
    $('folder').textContent = 'No folder chosen yet.';
    $('folderBtn').textContent = 'Choose extension folder…';
    return null;
  }
  const perm = await handle.queryPermission({ mode: 'readwrite' });
  $('folder').innerHTML = '';
  $('folder').append(`Folder: `, Object.assign(document.createElement('b'), { textContent: handle.name }),
    perm === 'granted' ? ' ✓' : ' (Chrome will ask to confirm access when you update)');
  $('folderBtn').textContent = 'Choose a different folder…';
  return handle;
}

async function chooseFolder() {
  let handle;
  try {
    handle = await window.showDirectoryPicker({ id: 'bass-trainer-extension', mode: 'readwrite' });
  } catch (err) {
    if (err.name !== 'AbortError') setStatus(`Could not open the folder: ${err.message}`, 'bad');
    return null;
  }
  const check = await verifyFolder(handle, own);
  if (!check.ok) {
    setStatus(check.reason, 'bad');
    return null;
  }
  await saveFolderHandle(handle);
  if (check.version !== own.version) {
    setStatus(`Folder saved, but it contains version ${check.version} while Chrome is running ${own.version}. Make sure this is the folder you loaded in chrome://extensions.`, 'warn');
  } else {
    setStatus('Folder saved.', 'good');
  }
  await showFolder();
  return handle;
}

async function check() {
  $('current').textContent = own.version;
  $('latest').textContent = '…';
  $('updateBtn').disabled = true;
  try {
    latest = await fetchLatest();
  } catch (err) {
    $('latest').textContent = '?';
    setStatus(`Could not check for updates: ${err.message}`, 'bad');
    return;
  }
  $('latest').textContent = latest.version;
  const date = latest.commitDate ? new Date(latest.commitDate).toLocaleString() : '';
  $('latestInfo').textContent = `Last change: "${latest.commitMessage}" (${date})`;
  const newer = compareVersions(latest.version, own.version) > 0;
  $('updateBtn').disabled = !newer;
  if (newer) setStatus(`Version ${latest.version} is available.`, 'warn');
  else setStatus('You have the latest version.', 'good');
  chrome.storage.local.set({
    updateCheck: { at: Date.now(), current: own.version, latest: latest.version, available: newer,
      commitMessage: latest.commitMessage, commitDate: latest.commitDate },
  });
}

async function update({ repair = false } = {}) {
  if (busy) return;
  busy = true;
  $('updateBtn').disabled = true;
  try {
    if (!latest) await check();
    if (!latest) return;
    let handle = await loadFolderHandle();
    if (!handle) {
      setStatus('First, choose the extension folder (one time only).', 'warn');
      handle = await chooseFolder();
      if (!handle) return;
    }
    if (!(await ensurePermission(handle))) {
      setStatus('Chrome did not allow writing to the folder. Click Update again and choose "Allow".', 'bad');
      return;
    }
    const verified = await verifyFolder(handle, own);
    if (!verified.ok) {
      setStatus(`${verified.reason} Choose the folder again below.`, 'bad');
      return;
    }
    const { installedFiles = [] } = await chrome.storage.local.get('installedFiles');
    setStatus(repair ? 'Re-downloading files…' : `Updating to ${latest.version}…`);
    const result = await applyUpdate(handle, latest, {
      previouslyInstalled: installedFiles,
      onProgress: (p) => {
        $('progress').textContent = p.total === 0 ? 'All files already up to date.'
          : `${p.phase === 'download' ? 'Downloading' : 'Writing'} ${p.done} / ${p.total} files`;
      },
    });
    await chrome.storage.local.set({
      installedFiles: result.installed,
      justUpdated: { from: own.version, to: latest.version, at: Date.now(), files: result.changed.length },
      updateCheck: null,
    });
    setStatus(`Done: ${result.changed.length} file(s) updated. Restarting the extension… Songsterr tabs will reload automatically.`, 'good');
    setTimeout(() => chrome.runtime.reload(), 1200);
  } catch (err) {
    setStatus(`Update failed: ${err.message}`, 'bad');
  } finally {
    busy = false;
    if (latest) $('updateBtn').disabled = compareVersions(latest.version, own.version) <= 0;
  }
}

$('checkBtn').addEventListener('click', check);
$('updateBtn').addEventListener('click', () => update());
$('repairBtn').addEventListener('click', () => update({ repair: true }));
$('folderBtn').addEventListener('click', chooseFolder);

if (!('showDirectoryPicker' in window)) {
  setStatus('This Chrome version cannot write files. Update Chrome, or update by hand (see below).', 'bad');
}
showFolder();
check();
