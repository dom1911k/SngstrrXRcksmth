import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { compareVersions, gitBlobSha, verifyFolder, applyUpdate, fetchLatest } from '../extension/src/core/updater.js';

// Minimal in-memory FileSystemDirectoryHandle.
class Dir {
  constructor(name = 'extension') { this.name = name; this.entries = new Map(); }
  async getDirectoryHandle(n, { create } = {}) {
    let e = this.entries.get(n);
    if (!e) { if (!create) throw new DOMException('nf', 'NotFoundError'); e = new Dir(n); this.entries.set(n, e); }
    return e;
  }
  async getFileHandle(n, { create } = {}) {
    let e = this.entries.get(n);
    if (!e) { if (!create) throw new DOMException('nf', 'NotFoundError'); e = { kind: 'file', bytes: new Uint8Array() }; this.entries.set(n, e); }
    return {
      getFile: async () => ({ arrayBuffer: async () => e.bytes.slice().buffer }),
      createWritable: async () => { const chunks = []; return { write: async (b) => chunks.push(b), close: async () => { e.bytes = new Uint8Array(chunks[0]); } }; },
    };
  }
  async removeEntry(n) { if (!this.entries.delete(n)) throw new DOMException('nf', 'NotFoundError'); }
  put(path, text) { const parts = path.split('/'); let d = this; for (const p of parts.slice(0, -1)) { if (!d.entries.has(p)) d.entries.set(p, new Dir(p)); d = d.entries.get(p); } d.entries.set(parts.at(-1), { bytes: new TextEncoder().encode(text) }); }
  get(path) { const parts = path.split('/'); let d = this; for (const p of parts.slice(0, -1)) { d = d.entries.get(p); if (!d) return null; } const f = d.entries.get(parts.at(-1)); return f ? new TextDecoder().decode(f.bytes) : null; }
}

const enc = (s) => new TextEncoder().encode(s);

test('versions compare numerically', () => {
  assert.equal(compareVersions('0.10.0', '0.9.9'), 1);
  assert.equal(compareVersions('0.1.1', '0.1.1'), 0);
  assert.equal(compareVersions('0.1', '0.1.2'), -1);
});

test('blob hash matches git hash-object', async () => {
  const path = 'extension/manifest.json';
  const expected = execSync(`git hash-object ${path}`).toString().trim();
  assert.equal(await gitBlobSha(readFileSync(path)), expected);
});

test('verifyFolder accepts our folder and rejects parent/other folders', async () => {
  const own = { name: 'Bass Trainer for Songsterr', key: 'K', version: '0.1.0' };
  const good = new Dir(); good.put('manifest.json', JSON.stringify(own));
  assert.deepEqual(await verifyFolder(good, own), { ok: true, version: '0.1.0' });
  const parent = new Dir('BassTrainer'); parent.put('extension/manifest.json', '{}');
  assert.match((await verifyFolder(parent, own)).reason, /outer folder/);
  const other = new Dir(); other.put('manifest.json', JSON.stringify({ name: 'Other', key: 'Z' }));
  assert.match((await verifyFolder(other, own)).reason, /different extension/);
});

async function remote(files) {
  const list = [];
  for (const [path, text] of Object.entries(files)) list.push({ path, sha: await gitBlobSha(enc(text)), text });
  return list;
}

function fakeFetch(files, { failPath } = {}) {
  const calls = [];
  const fn = async (url) => {
    calls.push(url);
    const ok = (body, isJson = true) => ({ ok: true, status: 200, json: async () => body, arrayBuffer: async () => enc(body).buffer });
    if (url.endsWith('/repos/dom1911k/SngstrrXRcksmth')) return ok({ default_branch: 'main' });
    if (url.includes('/commits/main')) return ok({ sha: 'c0ffee', commit: { tree: { sha: 'tree1' }, message: 'Phase 2\n\nbody', committer: { date: '2026-10-24T10:00:00Z' } } });
    if (url.includes('/git/trees/tree1')) return ok({ truncated: false, tree: [
      { type: 'blob', path: 'README.md', sha: 'x' },
      { type: 'tree', path: 'extension', sha: 'y' },
      ...files.map((f) => ({ type: 'blob', path: `extension/${f.path}`, sha: f.sha })),
    ] });
    const m = url.match(/raw\.githubusercontent\.com\/dom1911k\/SngstrrXRcksmth\/c0ffee\/extension\/(.+)$/);
    if (m) {
      const path = m[1].split('/').map(decodeURIComponent).join('/');
      if (path === failPath) return { ok: false, status: 404 };
      const f = files.find((x) => x.path === path);
      if (!f) return { ok: false, status: 404 };
      return { ok: true, status: 200, json: async () => JSON.parse(f.text), arrayBuffer: async () => enc(f.text).buffer };
    }
    return { ok: false, status: 404 };
  };
  fn.calls = calls;
  return fn;
}

test('fetchLatest reads version, commit and only extension/ files', async () => {
  const files = await remote({ 'manifest.json': '{"version":"0.2.0"}', 'src/main.js': 'new' });
  const latest = await fetchLatest(fakeFetch(files));
  assert.equal(latest.version, '0.2.0');
  assert.equal(latest.commitMessage, 'Phase 2');
  assert.deepEqual(latest.files.map((f) => f.path).sort(), ['manifest.json', 'src/main.js']);
});

test('applyUpdate writes only changed files, manifest last, removes dropped files', async () => {
  const files = await remote({
    'manifest.json': '{"version":"0.2.0"}', 'src/main.js': 'same', 'src/new/thing.js': 'added', 'src/changed.js': 'v2',
  });
  const dir = new Dir();
  dir.put('manifest.json', '{"version":"0.1.0"}');
  dir.put('src/main.js', 'same');
  dir.put('src/changed.js', 'v1');
  dir.put('src/old.js', 'obsolete');
  dir.put('notes.txt', 'user file, never tracked');
  const fetchFn = fakeFetch(files);
  const latest = await fetchLatest(fetchFn);
  const order = [];
  const r = await applyUpdate(dir, latest, {
    fetchFn,
    previouslyInstalled: ['manifest.json', 'src/main.js', 'src/changed.js', 'src/old.js'],
    onProgress: (p) => order.push(p),
  });
  assert.deepEqual(r.changed, ['src/new/thing.js', 'src/changed.js', 'manifest.json']);
  assert.deepEqual(r.removed, ['src/old.js']);
  assert.equal(dir.get('src/changed.js'), 'v2');
  assert.equal(dir.get('src/new/thing.js'), 'added');
  assert.equal(dir.get('manifest.json'), '{"version":"0.2.0"}');
  assert.equal(dir.get('src/old.js'), null);
  assert.equal(dir.get('notes.txt'), 'user file, never tracked');
  assert.ok(!fetchFn.calls.some((u) => u.endsWith('/src/main.js')), 'unchanged file was downloaded');
});

test('applyUpdate changes nothing if any download fails', async () => {
  const files = await remote({ 'manifest.json': '{"version":"0.2.0"}', 'src/a.js': 'A2', 'src/b.js': 'B2' });
  const dir = new Dir();
  dir.put('manifest.json', '{"version":"0.1.0"}'); dir.put('src/a.js', 'A1'); dir.put('src/b.js', 'B1');
  const fetchFn = fakeFetch(files, { failPath: 'src/b.js' });
  const latest = await fetchLatest(fetchFn);
  await assert.rejects(applyUpdate(dir, latest, { fetchFn }), /Nothing was changed/);
  assert.equal(dir.get('src/a.js'), 'A1');
  assert.equal(dir.get('manifest.json'), '{"version":"0.1.0"}');
});
