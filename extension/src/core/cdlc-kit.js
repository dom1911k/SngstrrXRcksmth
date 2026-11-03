// "RS2014 CDLC kit": a ZIP with a ready song folder for the RS2014converter
// (make_cdlc, https://github.com/dom1911k/RS2014converter):
//
//   Artist - Title/
//     song.yaml                    title, artist, the tab file, 5-string / pick,
//                                  and (from the player) the audio file and its offset
//     Artist - Title.btchart.json  the bass chart (notes, rhythms, sections, techniques)
//     README.txt                   what to do next
//     <your audio file>            when made in the player (RS2014 kit card)
//
// Without the audio you add it yourself; then drag the folder onto drop_song_folder_here.bat.
// The tuning is not written: the converter takes it from the chart and can
// detect a recording that is tuned differently.

const safeName = (s) => String(s || '').replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Song';
const yamlStr = (s) => JSON.stringify(String(s || ''));   // a JSON string is a valid YAML string

export function kitFiles(chart, { title, artist, url = '', audioName = '', offset = null } = {}) {
  const meta = chart.meta || {};
  const t = String(title || meta.title || 'Untitled').replace(/^Drill: /, '');
  const a = String(artist || meta.artist || 'Unknown artist');
  const folder = safeName(`${a} - ${t}`);
  const tabName = `${folder}.btchart.json`;
  const strings = chart.instrument.tuning.length;
  const picked = /pick/i.test(`${meta.instrument || ''} ${meta.track || ''}`);
  const yaml = [
    '# Made by the Bass Trainer extension. Put the song\'s audio file in this folder,',
    '# then drag the folder onto drop_song_folder_here.bat (RS2014converter).',
    url ? `# Tab: ${url}` : null,
    `title: ${yamlStr(t)}`,
    `artist: ${yamlStr(a)}`,
    '# album: ""',
    '# year: 2000',
    `tab: ${yamlStr(tabName)}`,
    audioName ? `audio: ${yamlStr(audioName)}` : null,
    offset !== null && Number.isFinite(offset) ? `chart_offset: ${offset.toFixed(3)}   # audio time where the chart starts (set in the Bass Trainer player)` : null,
    strings !== 4 ? `strings: ${strings}` : null,
    picked ? 'bass_picked: true' : null,
    '',
  ].filter((x) => x !== null).join('\n');
  const readme = [
    `${a} - ${t}: Rocksmith 2014 CDLC kit`,
    '',
    ...(audioName ? [`1. The audio file (${audioName}) is already in this folder, synced in the Bass Trainer player.`] : [
      '1. Put the song\'s audio file in this folder (one you own: CD rip, purchased',
      '   download...; FLAC, WAV, MP3, OGG or M4A). The same recording the tab was made',
      '   for lines up best, but another version works too: the tab is aligned beat by beat.',
      '   Tip: make the kit in the Bass Trainer player instead (open the song\'s audio there',
      '   and press Auto-sync): the audio and its exact start are then included.']),
    '2. Optional: a cover image (cover.jpg) and album / year in song.yaml.',
    '3. Drag this folder onto drop_song_folder_here.bat in the RS2014converter folder.',
    '   The CDLC appears in the "output" folder; read report.txt and listen to',
    '   review\\check_mix.wav before playing.',
    '',
    'The chart comes from the bass tab you had open; it is for your own use only.',
    '',
  ].join('\r\n');
  return {
    folder,
    files: [
      { name: `${folder}/song.yaml`, text: yaml },
      // "format" first (the chart may come back from chrome.storage with its keys sorted).
      { name: `${folder}/${tabName}`, text: JSON.stringify({ format: chart.format, version: chart.version, ...chart }, null, 1) },
      { name: `${folder}/README.txt`, text: readme },
    ],
  };
}

// ---------- minimal ZIP writer (stored, no compression) ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// files: [{ name, text | bytes }] -> Uint8Array (a .zip file)
export function zipFiles(files, date = new Date()) {
  const enc = new TextEncoder();
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const dosDate = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  const locals = [], centrals = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const data = f.bytes || enc.encode(f.text);
    const crc = crc32(data);
    const head = new DataView(new ArrayBuffer(30));
    head.setUint32(0, 0x04034b50, true);
    head.setUint16(4, 20, true);
    head.setUint16(6, 0x0800, true);          // UTF-8 names
    head.setUint16(8, 0, true);               // stored
    head.setUint16(10, dosTime, true);
    head.setUint16(12, dosDate, true);
    head.setUint32(14, crc, true);
    head.setUint32(18, data.length, true);
    head.setUint32(22, data.length, true);
    head.setUint16(26, name.length, true);
    locals.push(new Uint8Array(head.buffer), name, data);
    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true);
    cen.setUint16(4, 20, true);
    cen.setUint16(6, 20, true);
    cen.setUint16(8, 0x0800, true);
    cen.setUint16(12, dosTime, true);
    cen.setUint16(14, dosDate, true);
    cen.setUint32(16, crc, true);
    cen.setUint32(20, data.length, true);
    cen.setUint32(24, data.length, true);
    cen.setUint16(28, name.length, true);
    cen.setUint32(42, offset, true);
    centrals.push(new Uint8Array(cen.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const cenSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, cenSize, true);
  end.setUint32(16, offset, true);
  const parts = [...locals, ...centrals, new Uint8Array(end.buffer)];
  const out = new Uint8Array(parts.reduce((n, b) => n + b.length, 0));
  let p = 0;
  for (const b of parts) { out.set(b, p); p += b.length; }
  return out;
}
