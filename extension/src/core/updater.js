// Self-update from GitHub for the unpacked extension.
//
// Chrome can't replace an unpacked extension by itself, but an extension page
// may write into a folder the user picked (File System Access API). So:
//   1. once: the user picks the extension folder; the handle is kept in IndexedDB
//   2. check: compare our version with extension/manifest.json on GitHub
//   3. update: download changed files (by git blob hash), write them, reload
//
// The repository is public, so no login/token is needed. Only files under
// `extension/` in the repository are ever written, and only inside the
// picked folder.

export const SOURCE = { owner: 'dom1911k', repo: 'SngstrrXRcksmth', dir: 'extension/' };

const API = 'https://api.github.com';
const RAW = 'https://raw.githubusercontent.com';

export function compareVersions(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

async function getJson(fetchFn, url) {
  const res = await fetchFn(url, { cache: 'no-store', headers: { Accept: 'application/vnd.github+json' } });
  if (res.status === 403 || res.status === 429) throw new Error('GitHub rate limit reached. Try again in an hour.');
  if (!res.ok) throw new Error(`GitHub request failed (${res.status}): ${url}`);
  return res.json();
}

// Latest release on the repository's default branch.
export async function fetchLatest(fetchFn = fetch, source = SOURCE) {
  const repo = await getJson(fetchFn, `${API}/repos/${source.owner}/${source.repo}`);
  const branch = repo.default_branch;
  const commit = await getJson(fetchFn, `${API}/repos/${source.owner}/${source.repo}/commits/${encodeURIComponent(branch)}`);
  const tree = await getJson(fetchFn, `${API}/repos/${source.owner}/${source.repo}/git/trees/${commit.commit.tree.sha}?recursive=1`);
  if (tree.truncated) throw new Error('Repository listing was truncated; cannot update safely.');
  const files = tree.tree
    .filter((e) => e.type === 'blob' && e.path.startsWith(source.dir))
    .map((e) => ({ path: e.path.slice(source.dir.length), sha: e.sha, size: e.size }));
  const manifestRes = await fetchFn(`${RAW}/${source.owner}/${source.repo}/${commit.sha}/${source.dir}manifest.json`, { cache: 'no-store' });
  if (!manifestRes.ok) throw new Error('Could not read the new manifest.json.');
  const manifest = await manifestRes.json();
  return {
    version: manifest.version,
    branch,
    commitSha: commit.sha,
    commitDate: commit.commit.committer && commit.commit.committer.date,
    commitMessage: (commit.commit.message || '').split('\n')[0],
    files,
  };
}

// Git's blob hash: sha1("blob <size>\0" + content).
export async function gitBlobSha(bytes) {
  const header = new TextEncoder().encode(`blob ${bytes.byteLength}\0`);
  const all = new Uint8Array(header.length + bytes.byteLength);
  all.set(header, 0);
  all.set(new Uint8Array(bytes), header.length);
  const digest = await crypto.subtle.digest('SHA-1', all);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function getDir(root, parts, create) {
  let dir = root;
  for (const p of parts) dir = await dir.getDirectoryHandle(p, { create });
  return dir;
}

async function readLocal(root, path) {
  const parts = path.split('/');
  try {
    const dir = await getDir(root, parts.slice(0, -1), false);
    const file = await (await dir.getFileHandle(parts[parts.length - 1])).getFile();
    return new Uint8Array(await file.arrayBuffer());
  } catch {
    return null;
  }
}

async function writeLocal(root, path, bytes) {
  const parts = path.split('/');
  const dir = await getDir(root, parts.slice(0, -1), true);
  const handle = await dir.getFileHandle(parts[parts.length - 1], { create: true });
  const w = await handle.createWritable();
  await w.write(bytes);
  await w.close();
}

async function removeLocal(root, path) {
  const parts = path.split('/');
  try {
    const dir = await getDir(root, parts.slice(0, -1), false);
    await dir.removeEntry(parts[parts.length - 1]);
  } catch { /* already gone */ }
}

// Make sure the picked folder really is this extension (not its parent, not
// some other folder): it must contain a manifest.json with our key/name.
export async function verifyFolder(root, ownManifest) {
  const bytes = await readLocal(root, 'manifest.json');
  if (!bytes) {
    const inner = await readLocal(root, 'extension/manifest.json');
    if (inner) return { ok: false, reason: 'This is the outer folder. Please pick the "extension" folder inside it.' };
    return { ok: false, reason: 'No manifest.json in this folder. Pick the "extension" folder you loaded in chrome://extensions.' };
  }
  let m;
  try { m = JSON.parse(new TextDecoder().decode(bytes)); } catch { return { ok: false, reason: 'manifest.json in this folder is unreadable.' }; }
  const sameKey = ownManifest.key ? m.key === ownManifest.key : true;
  if (m.name !== ownManifest.name || !sameKey) {
    return { ok: false, reason: `This folder contains a different extension ("${m.name}").` };
  }
  return { ok: true, version: m.version };
}

// Download every changed file first (nothing is written if a download
// fails), then write them with manifest.json last, then remove files that a
// previous update installed but that no longer exist upstream.
export async function applyUpdate(root, latest, {
  fetchFn = fetch,
  previouslyInstalled = [],
  onProgress = () => {},
  source = SOURCE,
} = {}) {
  const changed = [];
  for (const f of latest.files) {
    const local = await readLocal(root, f.path);
    if (!local || (await gitBlobSha(local)) !== f.sha) changed.push(f);
  }
  onProgress({ phase: 'download', done: 0, total: changed.length });
  const downloads = [];
  for (const f of changed) {
    const url = `${RAW}/${source.owner}/${source.repo}/${latest.commitSha}/${source.dir}${f.path.split('/').map(encodeURIComponent).join('/')}`;
    const res = await fetchFn(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Download failed (${res.status}) for ${f.path}. Nothing was changed.`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    if ((await gitBlobSha(bytes)) !== f.sha) throw new Error(`Downloaded ${f.path} is corrupt. Nothing was changed.`);
    downloads.push({ path: f.path, bytes });
    onProgress({ phase: 'download', done: downloads.length, total: changed.length });
  }
  downloads.sort((a, b) => (a.path === 'manifest.json') - (b.path === 'manifest.json'));
  let written = 0;
  for (const d of downloads) {
    await writeLocal(root, d.path, d.bytes);
    onProgress({ phase: 'write', done: ++written, total: downloads.length });
  }
  const now = new Set(latest.files.map((f) => f.path));
  const removed = previouslyInstalled.filter((p) => !now.has(p));
  for (const p of removed) await removeLocal(root, p);
  return { changed: downloads.map((d) => d.path), removed, installed: [...now] };
}

// ---- Folder handle persistence (IndexedDB of the extension origin) ----

function idb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('bass-trainer-updater', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveFolderHandle(handle) {
  const db = await idb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction('kv', 'readwrite');
    tx.objectStore('kv').put(handle, 'folder');
    tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
  });
}

export async function loadFolderHandle() {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const req = db.transaction('kv').objectStore('kv').get('folder');
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}
