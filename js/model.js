// Pure data logic shared by the web manager. Mirrors the Android app (Models.kt, *Actions.kt) so that
// everything written here decodes on the phones. Payloads are edited as raw JSON objects: unknown fields
// written by newer app versions are always preserved.

const QR_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
export const INVITE_PREFIX = 'SCLEAN-SYNC|';
export const PBKDF2_ITERATIONS = 120000;
export const MIN_MANAGER_PASSWORD_LENGTH = 6;
export const WORKER_LANGS = ['de', 'en', 'pl', 'ro', 'sq', 'tr', 'uk', 'es', 'ru', 'ar'];

const enc = new TextEncoder();
const subtle = () => globalThis.crypto.subtle;

export function randomBytes(n) {
  const b = new Uint8Array(n);
  globalThis.crypto.getRandomValues(b);
  return b;
}
export const toHex = (bytes) => Array.from(bytes, (x) => x.toString(16).padStart(2, '0')).join('');
export function base64UrlNoPad(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export async function sha256Hex(text) {
  return toHex(new Uint8Array(await subtle().digest('SHA-256', enc.encode(text))));
}

// ---------- Hashes (RoleSecurity) ----------
/** Worker PIN, verified by the server (sc_verify_pin_hash): "v1:<salt>:<sha256(salt:pin)>". */
export async function hashWorkerPin(rawPin, saltHex = toHex(randomBytes(12))) {
  const clean = String(rawPin ?? '').trim();
  if (!clean) return '';
  return `v1:${saltHex}:${await sha256Hex(`${saltHex}:${clean}`)}`;
}
/** Manager password, verified on the phone: "v2:<iter>:<salt>:<pbkdf2>". Salt bytes = UTF-8 of the hex text. */
export async function hashManagerPassword(raw, saltHex = toHex(randomBytes(16)), iterations = PBKDF2_ITERATIONS) {
  const clean = String(raw ?? '').trim();
  if (!clean) return '';
  const key = await subtle().importKey('raw', enc.encode(clean), 'PBKDF2', false, ['deriveBits']);
  const bits = await subtle().deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(saltHex), iterations },
    key,
    256,
  );
  return `v2:${iterations}:${saltHex}:${toHex(new Uint8Array(bits))}`;
}

// ---------- Worker invites (SupabaseSyncClient.encodeSetupInvite) ----------
export async function newInviteToken() {
  const raw = base64UrlNoPad(randomBytes(24));
  return { raw, hash: await sha256Hex(raw) };
}
export function normalizeUrl(raw) {
  let s = String(raw ?? '').trim().replace(/\/+$/, '');
  if (s && !/^https?:\/\//.test(s)) s = `https://${s}`;
  return s;
}
export function encodeSetupInvite({ url, key, workerCode = '', companyId = 'default', token = '', type = 'personal' }) {
  const json = JSON.stringify({
    u: normalizeUrl(url),
    k: String(key).trim(),
    w: String(workerCode).trim(),
    c: String(companyId).trim() || 'default',
    t: String(token).trim(),
    m: String(type).trim() || 'personal',
  });
  return INVITE_PREFIX + base64UrlNoPad(enc.encode(json));
}

// ---------- QR codes (BuildingQrValidator) ----------
export const normalizeQr = (code) => String(code ?? '').trim().replace(/\s+/g, '').toLowerCase();

export function acceptedTokens(b) {
  return [...new Set([b.qrCode, ...(b.qrAliases || []), b.id].map(normalizeQr).filter(Boolean))];
}
export function reservedTokens(buildings, retired = []) {
  const set = new Set();
  for (const b of buildings) {
    [b.qrCode, ...(b.qrAliases || [])].map(normalizeQr).filter(Boolean).forEach((t) => set.add(t));
    if (normalizeQr(b.id)) set.add(normalizeQr(b.id));
  }
  for (const r of retired) {
    const t = normalizeQr(r.qrCodeNormalized || r.originalQrCode);
    if (t) set.add(t);
  }
  return set;
}
export function nextUniqueQrCode(buildings, retired = []) {
  const reserved = reservedTokens(buildings, retired);
  for (let i = 0; i < 64; i++) {
    const suffix = Array.from(randomBytes(8), (x) => QR_ALPHABET[x % QR_ALPHABET.length]).join('');
    const candidate = `SCLEAN-OBJ-${suffix}`;
    if (!reserved.has(normalizeQr(candidate))) return candidate;
  }
  return `SCLEAN-OBJ-${toHex(randomBytes(6)).toUpperCase()}`;
}
/** Building using any of `candidate`'s codes, or null. */
export function findQrConflict(candidate, buildings) {
  const mine = new Set(acceptedTokens(candidate));
  return buildings.find((o) => o.id !== candidate.id && acceptedTokens(o).some((t) => mine.has(t))) || null;
}
export function isRetired(code, retired = []) {
  const n = normalizeQr(code);
  return !!n && retired.some((r) => normalizeQr(r.qrCodeNormalized || r.originalQrCode) === n);
}

// ---------- Buildings ----------
export function newBuilding({ name = '', address = '', clientName = '' } = {}, buildings = [], retired = [], now = Date.now()) {
  return {
    id: `bldg-${now}`,
    qrCode: nextUniqueQrCode(buildings, retired),
    name,
    address,
    clientName,
    clientEmail: '',
    clientPhone: '',
    contractNumber: '',
    accessHint: '',
    keyAlarmInfo: '',
    minPhotosRequired: 0,
    requireBeforeAfterPhotos: false,
    requireGpsCheckIn: false,
    tasks: [],
    scheduledDays: [1, 2, 3, 4, 5],
    assignedWorkerCodes: [],
    updatedAtMs: 0,
    qrAliases: [],
    scheduleFrequency: 'WEEKLY',
    scheduleAnchorDate: '',
    monthlyDayOfMonth: 1,
    visitsPerDay: 1,
    shiftWindows: [],
    replacementWorkerCode: '',
    replacementUntilDate: '',
  };
}

/**
 * Applies an edit like MainViewModel.saveBuilding: a changed primary QR keeps the old one as an alias
 * so printed posters never stop working.
 */
export function applyBuildingEdit(existing, edited) {
  const primary = String(edited.qrCode ?? '').trim();
  const pNorm = normalizeQr(primary);
  const aliases = [
    ...(existing?.qrAliases || []),
    ...(edited.qrAliases || []),
    ...(existing && normalizeQr(existing.qrCode) && normalizeQr(existing.qrCode) !== pNorm ? [existing.qrCode] : []),
  ]
    .map((a) => String(a).trim())
    .filter((a) => a && normalizeQr(a) !== pNorm);
  const seen = new Set();
  const qrAliases = aliases.filter((a) => (seen.has(normalizeQr(a)) ? false : seen.add(normalizeQr(a))));
  return { ...existing, ...edited, qrCode: primary, qrAliases };
}

export function newTask(areaDe, labelDe, required = true, now = Date.now(), idx = 0) {
  return { id: `t-${now}-${idx}`, areaDe, areaTranslations: {}, labelDe, labelTranslations: {}, required };
}
export function instantiateTasks(tasks, idPrefix) {
  return tasks.map((t, i) => ({ ...t, id: `${idPrefix}-${i + 1}` }));
}
export function taskText(task, lang, field) {
  const tr = task[`${field}Translations`] || {};
  return tr[lang] || task[`${field}De`] || Object.values(tr).find(Boolean) || '';
}

export function parseIsoDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s ?? '').trim());
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null;
}
export const isoDay = (d) => ((d.getUTCDay() + 6) % 7) + 1; // Mon=1..Sun=7
export const toUtcDate = (d) => new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
export const isoDateString = (d) => d.toISOString().slice(0, 10);
const mondayOf = (d) => new Date(d.getTime() - (isoDay(d) - 1) * 86400000);

/** BuildingObject.isScheduledForDate; `date` is a UTC-midnight Date for the local calendar day. */
export function isScheduledOn(b, date) {
  const days = b.scheduledDays || [];
  switch (b.scheduleFrequency || 'WEEKLY') {
    case 'MONTHLY': {
      const len = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
      return date.getUTCDate() === Math.min(Math.max(b.monthlyDayOfMonth || 1, 1), len);
    }
    case 'BIWEEKLY': {
      if (!days.includes(isoDay(date))) return false;
      const anchor = parseIsoDate(b.scheduleAnchorDate);
      if (!anchor) return true;
      const weeks = Math.round((mondayOf(date) - mondayOf(anchor)) / (7 * 86400000));
      return ((weeks % 2) + 2) % 2 === 0;
    }
    default:
      return days.includes(isoDay(date));
  }
}
export const visitsPerDay = (b) => Math.min(Math.max(b.visitsPerDay || 1, 1), 4);

export function activeReplacement(b, date) {
  const code = String(b.replacementWorkerCode || '').trim();
  if (!code) return null;
  const until = String(b.replacementUntilDate || '').trim();
  if (!until) return code;
  const u = parseIsoDate(until);
  return u && date <= u ? code : null;
}
export function effectiveWorkerCodes(b, date) {
  const cover = activeReplacement(b, date);
  return cover ? [cover] : b.assignedWorkerCodes || [];
}

// ---------- Reports ----------
export function formatDateTime(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
/** Fields for sc_upsert_report_cas(p_review_only = true); the server merges only these. */
export function reviewFields(status, note, reviewer, now = Date.now()) {
  return {
    verificationStatus: status,
    reviewNote: String(note ?? '').trim(),
    verifiedBy: String(reviewer || '').trim() || 'Inhaber',
    verifiedAtFormatted: formatDateTime(now),
  };
}
export function parseGps(summary) {
  const m = /(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/.exec(String(summary ?? '').trim());
  return m ? { lat: +m[1], lon: +m[2] } : null;
}

// ---------- Issues (createOrUpdateIssueTicket) ----------
export function newIssue({ buildingId, buildingName = '', title, description = '', assignedWorkerCode = '' }, actor, now = Date.now()) {
  return {
    id: `iss_${now}_${toHex(randomBytes(3))}`,
    buildingId,
    buildingName,
    categoryId: 'custom',
    title: String(title).trim(),
    description: String(description).trim(),
    status: 'OPEN',
    assignedWorkerCode: String(assignedWorkerCode).trim(),
    reportedByName: actor,
    reportedByWorkerCode: '',
    reportedByWorkerId: '',
    sourceReportId: '',
    createdAtMs: now,
    updatedAtMs: now,
    resolvedAtMs: 0,
    resolvedByName: '',
    resolutionNote: '',
    cloudUpdatedAtMs: 0,
    syncStatus: 'SYNCED',
  };
}
export function applyIssueUpdate(issue, { status, resolutionNote, assignedWorkerCode }, actor, now = Date.now()) {
  const next = {
    ...issue,
    status: status ?? issue.status,
    resolutionNote: String(resolutionNote ?? issue.resolutionNote ?? '').trim(),
    assignedWorkerCode: String(assignedWorkerCode ?? issue.assignedWorkerCode ?? '').trim(),
    updatedAtMs: Math.max(now, (issue.updatedAtMs || 0) + 1),
  };
  if (next.status === 'RESOLVED') {
    next.resolvedAtMs = issue.status === 'RESOLVED' && issue.resolvedAtMs ? issue.resolvedAtMs : now;
    next.resolvedByName = issue.status === 'RESOLVED' && issue.resolvedByName ? issue.resolvedByName : actor;
  } else {
    next.resolvedAtMs = 0;
    next.resolvedByName = '';
  }
  return next;
}

// ---------- Company ----------
/** Public profile for sc_upsert_company_cas: secrets never go into the payload. */
export function publicCompany(profile) {
  const { ownerPin, ownerPinHash, ...rest } = profile;
  return rest;
}
export function newTemplate({ name, tasks = [], defaultScheduledDays = [1, 2, 3, 4, 5], defaultMinPhotos = 0, defaultRequireBeforeAfter = false }, now = Date.now()) {
  return { id: `tpl-${now}`, name: String(name).trim(), tasks, defaultScheduledDays, defaultMinPhotos, defaultRequireBeforeAfter, updatedAtMs: now };
}

// ---------- Workers ----------
export function newWorker({ workerCode, name, preferredLangCode = 'de', phone = '' }, now = Date.now()) {
  return { id: `w-${now}`, workerCode: String(workerCode).trim(), name: String(name).trim(), preferredLangCode, phone: String(phone).trim(), active: true, authUserId: '', updatedAtMs: 0 };
}
export function suggestWorkerCode(workers) {
  const nums = workers.map((w) => +(/(\d+)$/.exec(w.workerCode || '')?.[1] ?? 0));
  return `M${Math.max(100, ...nums) + 1}`;
}

// ---------- Overview ----------
export function todayStatus(buildings, reports, date) {
  const dayStart = new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()).getTime();
  const dayEnd = dayStart + 86400000;
  return buildings
    .filter((b) => isScheduledOn(b, date))
    .map((b) => {
      const done = reports.filter((r) => r.buildingId === b.id && r.checkOutEpochMs >= dayStart && r.checkOutEpochMs < dayEnd).length;
      return { building: b, done, required: visitsPerDay(b), workers: effectiveWorkerCodes(b, date) };
    });
}

export function csvEscape(v) {
  let s = String(v ?? '');
  if (/^[=+\-@\t]/.test(s)) s = `'${s}`;
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
