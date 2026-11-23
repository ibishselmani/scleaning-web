// Cloud backup in the app's own backup format, so it can be restored in the app (Settings → Local backup → restore,
// optionally straight into the cloud). Pure functions; the Company page fetches the data and saves the file.
// Format: LocalBackupBundle v5 as backup.json, or a ZIP with backup.json + photos/… + signatures/… (stored, no
// compression: photos are already JPEG/PNG).

export const BACKUP_VERSION = 5;
// Limits of the app's importer (BackupArchiveCodec).
const MAX_JSON = 16 * 1024 * 1024;
const MAX_ZIP = 200 * 1024 * 1024;
const MAX_ENTRIES = 5000;
const MEDIA_EXT = new Set(['jpg', 'jpeg', 'png', 'webp']);

export const workerAccount = (w) => ({
  id: w.id, workerCode: w.workerCode, name: w.name, preferredLangCode: w.preferredLangCode || 'de', phone: w.phone || '',
  active: !!w.active, authUserId: w.authUserId || '', updatedAtMs: w.updatedAtMs || 0, sharedPinHash: '', hasSharedPin: !!w.hasPin,
});

export function buildBundle({ company, buildings, workers, reports, retired, issues, billing, companyId, now = Date.now() }) {
  return {
    version: BACKUP_VERSION,
    billing: billing || null,
    exportedAtEpochMs: now,
    companyProfile: { ...company },
    buildings: buildings.map(({ _sort, ...b }) => b),
    workers: workers.map(workerAccount),
    reports,
    retiredQrCodes: retired,
    issueTickets: issues,
    sourceCompanyId: companyId || '',
    sourceAccountScope: '',
  };
}

const safe = (s) => String(s).replace(/[^A-Za-z0-9._-]/g, '_');

/** Which cloud files go into the ZIP and under which names (unique, app-safe, allowed extensions only). */
export function planMedia(reports) {
  const used = new Set();
  const plan = [];
  const add = (r, kind, index, remotePath) => {
    if (!remotePath) return;
    const base = safe(String(remotePath).split('/').pop() || '');
    const dot = base.lastIndexOf('.');
    const ext = dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
    if (!MEDIA_EXT.has(ext)) return;
    const stem = `${safe(r.id)}_${base.slice(0, dot)}`;
    let name = `${stem}.${base.slice(dot + 1)}`;
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${stem}_${n}.${base.slice(dot + 1)}`;
    used.add(name.toLowerCase());
    plan.push({ reportId: r.id, kind, index, remotePath, entryName: `${kind === 'photo' ? 'photos' : 'signatures'}/${name}` });
  };
  for (const r of reports) {
    (r.photos || []).forEach((p, i) => add(r, 'photo', i, p.remotePath));
    add(r, 'signature', -1, r.signatureRemotePath);
  }
  return plan;
}

/** Points the reports at the files that made it into the ZIP; cloud paths stay as they are. */
export function applyMedia(reports, plan, downloaded) {
  const byReport = new Map();
  for (const m of plan) if (downloaded.has(m.entryName)) (byReport.get(m.reportId) || byReport.set(m.reportId, []).get(m.reportId)).push(m);
  return reports.map((r) => {
    const media = byReport.get(r.id);
    if (!media) return r;
    const out = { ...r, photos: (r.photos || []).map((p) => ({ ...p })) };
    for (const m of media) {
      if (m.kind === 'photo') out.photos[m.index].filePath = m.entryName;
      else out.signatureFilePath = m.entryName;
    }
    return out;
  });
}

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

/**
 * ZIP (method "stored") as a list of parts for `new Blob(parts)`. Entries: {name, data: Uint8Array|Blob, size, crc}.
 * Large photos can stay Blobs, so the browser never needs the whole archive in one piece of memory.
 */
export function zipParts(entries, date = new Date()) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  const enc = new TextEncoder();
  const parts = [];
  const central = [];
  let offset = 0;
  for (const e of entries) {
    const name = enc.encode(e.name);
    const local = new DataView(new ArrayBuffer(30));
    [[0, 0x04034b50, 4], [4, 20, 2], [6, 0x0800, 2], [8, 0, 2], [10, time, 2], [12, day, 2], [14, e.crc, 4], [18, e.size, 4], [22, e.size, 4], [26, name.length, 2], [28, 0, 2]]
      .forEach(([at, v, len]) => (len === 4 ? local.setUint32(at, v, true) : local.setUint16(at, v, true)));
    parts.push(new Uint8Array(local.buffer), name, e.data);
    const cd = new DataView(new ArrayBuffer(46));
    [[0, 0x02014b50, 4], [4, 20, 2], [6, 20, 2], [8, 0x0800, 2], [10, 0, 2], [12, time, 2], [14, day, 2], [16, e.crc, 4], [20, e.size, 4], [24, e.size, 4],
      [28, name.length, 2], [30, 0, 2], [32, 0, 2], [34, 0, 2], [36, 0, 2], [38, 0, 4], [42, offset, 4]]
      .forEach(([at, v, len]) => (len === 4 ? cd.setUint32(at, v, true) : cd.setUint16(at, v, true)));
    central.push(new Uint8Array(cd.buffer), name);
    offset += 30 + name.length + e.size;
  }
  const cdSize = central.reduce((s, p) => s + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  [[0, 0x06054b50, 4], [4, 0, 2], [6, 0, 2], [8, entries.length, 2], [10, entries.length, 2], [12, cdSize, 4], [16, offset, 4], [20, 0, 2]]
    .forEach(([at, v, len]) => (len === 4 ? end.setUint32(at, v, true) : end.setUint16(at, v, true)));
  return [...parts, ...central, new Uint8Array(end.buffer)];
}

/** Which of the app's restore limits a backup would exceed ('json', 'zip', 'entries'). */
export function appLimits({ jsonBytes, zipBytes, entries }) {
  const out = [];
  if (jsonBytes > MAX_JSON) out.push('json');
  if (zipBytes > MAX_ZIP) out.push('zip');
  if (entries > MAX_ENTRIES) out.push('entries');
  return out;
}
