// Talks to the company's own Supabase project with the same REST/RPC calls the app uses.
// No server of our own: the browser calls Supabase directly; row-level security on the server decides access.
import { normalizeUrl } from './model.js?v=e23e5b5c61';
import { pickCloudBook } from './billing.js?v=e23e5b5c61';

export const BUCKET = 'scleaning-proofs';
const CFG_KEY = 'scleaning.web.project';
const SESSION_KEY = 'scleaning.web.session';

const safeStorage = (kind) => {
  try { return window[kind]; } catch { return null; }
};
const readJson = (store, key) => {
  try { return JSON.parse(store?.getItem(key) || 'null'); } catch { return null; }
};
const writeJson = (store, key, value) => {
  try { value == null ? store?.removeItem(key) : store?.setItem(key, JSON.stringify(value)); } catch { /* private mode */ }
};

export class CloudError extends Error {
  constructor(status, message, code = '') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function loadProjectConfig() {
  const fromHash = new URLSearchParams(location.hash.replace(/^#/, ''));
  if (fromHash.get('u') && fromHash.get('k')) {
    const cfg = { url: normalizeUrl(fromHash.get('u')), key: fromHash.get('k').trim() };
    writeJson(safeStorage('localStorage'), CFG_KEY, cfg);
    history.replaceState(null, '', location.pathname);
    return cfg;
  }
  return readJson(safeStorage('localStorage'), CFG_KEY);
}
/**
 * The password-reset email link returns here with `#access_token=…&type=recovery` (or `#error=…`). Reads that once
 * and removes it from the address bar, so the token never stays in history.
 */
export function takeAuthRedirect() {
  const h = new URLSearchParams(location.hash.replace(/^#/, ''));
  if (h.get('type') === 'recovery' && h.get('access_token')) {
    history.replaceState(null, '', location.pathname);
    return { recoveryToken: h.get('access_token') };
  }
  if (h.get('error_description') || h.get('error')) {
    history.replaceState(null, '', location.pathname);
    return { error: h.get('error_code') || h.get('error') || 'error' };
  }
  return null;
}

async function authFetch(url, key, path, { method = 'POST', body, token } = {}) {
  let res;
  try {
    res = await fetch(`${normalizeUrl(url)}/auth/v1/${path}`, {
      method,
      headers: { apikey: key, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    });
  } catch {
    throw new CloudError(0, 'network');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new CloudError(res.status, data.msg || data.error_description || data.message || `HTTP ${res.status}`, data.error_code || '');
  return data;
}
/** Sends the reset email; the link leads back to this page (must be allowed under Supabase → Auth → URL Configuration). */
export const requestPasswordReset = (cfg, email, redirectTo) =>
  authFetch(cfg.url, cfg.key, `recover?redirect_to=${encodeURIComponent(redirectTo)}`, { body: { email: email.trim() } });
export const setNewPassword = (cfg, token, password) =>
  authFetch(cfg.url, cfg.key, 'user', { method: 'PUT', token, body: { password } });

export function saveProjectConfig(cfg) {
  writeJson(safeStorage('localStorage'), CFG_KEY, cfg);
}

export class Cloud {
  constructor({ url, key }) {
    this.url = normalizeUrl(url);
    this.key = String(key).trim();
    this.session = readJson(safeStorage('sessionStorage'), SESSION_KEY) || readJson(safeStorage('localStorage'), SESSION_KEY);
    this.remember = !!readJson(safeStorage('localStorage'), SESSION_KEY);
    this.companyId = this.session?.companyId || '';
  }

  get signedIn() { return !!this.session?.access_token; }
  get email() { return this.session?.email || ''; }

  persist() {
    const s = this.session ? { ...this.session, companyId: this.companyId } : null;
    writeJson(safeStorage('sessionStorage'), SESSION_KEY, s);
    writeJson(safeStorage('localStorage'), SESSION_KEY, this.remember ? s : null);
  }

  async authCall(path, body) {
    let res;
    try {
      res = await fetch(`${this.url}/auth/v1/${path}`, {
        method: 'POST',
        headers: { apikey: this.key, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch {
      throw new CloudError(0, 'network');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new CloudError(res.status, data.error_description || data.msg || data.message || `HTTP ${res.status}`, data.error_code || data.error || '');
    return data;
  }

  takeSession(data) {
    this.session = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Date.now() + (data.expires_in || 3600) * 1000,
      user_id: data.user?.id || '',
      email: data.user?.email || '',
    };
    this.persist();
  }

  async signIn(email, password, remember) {
    this.remember = !!remember;
    this.takeSession(await this.authCall('token?grant_type=password', { email: email.trim(), password }));
    const memberships = await this.rpc('sc_my_memberships', {});
    const mgr = (memberships || []).find((m) => m.role === 'manager' && m.active);
    if (!mgr) {
      this.signOut();
      throw new CloudError(403, 'not_manager');
    }
    this.companyId = mgr.company_id;
    this.companyName = mgr.company_name;
    this.persist();
  }

  signOut() {
    const token = this.session?.access_token;
    if (token) fetch(`${this.url}/auth/v1/logout`, { method: 'POST', headers: { apikey: this.key, Authorization: `Bearer ${token}` } }).catch(() => {});
    this.session = null;
    this.companyId = '';
    this.persist();
  }

  async refresh() {
    if (!this.session?.refresh_token) throw new CloudError(401, 'session_expired');
    if (!this.refreshing) {
      this.refreshing = this.authCall('token?grant_type=refresh_token', { refresh_token: this.session.refresh_token })
        .then((d) => this.takeSession(d))
        .finally(() => { this.refreshing = null; });
    }
    return this.refreshing;
  }

  async req(method, path, { body, prefer, headers = {}, retry = true } = {}) {
    if (this.session && this.session.expires_at - Date.now() < 60000) await this.refresh().catch(() => {});
    let res;
    try {
      res = await fetch(`${this.url}${path}`, {
        method,
        headers: {
          apikey: this.key,
          Authorization: `Bearer ${this.session?.access_token || this.key}`,
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(prefer ? { Prefer: prefer } : {}),
          ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new CloudError(0, 'network');
    }
    if (res.status === 401 && retry && this.session?.refresh_token) {
      await this.refresh();
      return this.req(method, path, { body, prefer, headers, retry: false });
    }
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!res.ok) {
      const msg = (data && (data.message || data.error || data.msg)) || `HTTP ${res.status}`;
      throw new CloudError(res.status, msg, data?.code || '');
    }
    return data;
  }

  rpc(name, args) { return this.req('POST', `/rest/v1/rpc/${name}`, { body: args }); }

  /** CAS writes return one row {status, server_updated_at, server_payload, conflict_detail}. */
  async cas(name, args) {
    const rows = await this.rpc(name, { p_company_id: this.companyId, ...args });
    const row = Array.isArray(rows) ? rows[0] : rows;
    if (!row) throw new CloudError(500, 'empty_response');
    return row;
  }

  cid() { return encodeURIComponent(this.companyId || 'default'); }

  async getAll(table, query, pageSize = 500) {
    const out = [];
    for (let offset = 0; offset < 100000; offset += pageSize) {
      const page = await this.req('GET', `/rest/v1/${table}?company_id=eq.${this.cid()}&${query}&limit=${pageSize}&offset=${offset}`);
      out.push(...page);
      if (page.length < pageSize) break;
    }
    return out;
  }

  // ---------- Reads ----------
  async loadCompany() {
    const rows = await this.req('GET', `/rest/v1/sc_company?company_id=eq.${this.cid()}&select=payload,updated_at&limit=1`);
    const row = rows[0];
    return row ? { ...row.payload, updatedAtMs: row.updated_at } : null;
  }
  async loadBuildings() {
    const rows = await this.getAll('sc_buildings', 'select=payload,updated_at,sort_order&order=sort_order.asc,id.asc');
    return rows.map((r) => ({ ...r.payload, updatedAtMs: r.updated_at, _sort: r.sort_order }));
  }
  async loadWorkers() {
    const [rows, secrets] = await Promise.all([
      this.getAll('sc_workers', 'select=id,worker_code,name,preferred_lang,phone,active,auth_user_id,updated_at&order=worker_code.asc'),
      this.getAll('sc_worker_secrets', 'select=worker_id').catch(() => []),
    ]);
    const withPin = new Set(secrets.map((s) => s.worker_id));
    return rows.map((r) => ({
      id: r.id, workerCode: r.worker_code, name: r.name, preferredLangCode: r.preferred_lang, phone: r.phone,
      active: r.active, authUserId: r.auth_user_id || '', updatedAtMs: r.updated_at, hasPin: withPin.has(r.id),
    }));
  }
  async loadIssues() {
    try {
      const rows = await this.getAll('sc_issues', 'select=payload,updated_at&order=updated_at.desc,id.asc');
      return rows.map((r) => ({ ...r.payload, updatedAtMs: r.updated_at, cloudUpdatedAtMs: r.updated_at }));
    } catch (e) {
      if (e.status === 404 || e.code === '42P01' || e.code === 'PGRST205') return [];
      throw e;
    }
  }
  async loadRetired() {
    const rows = await this.getAll('sc_retired_qr_codes', 'select=qr_code_normalized,original_qr_code,building_id,building_name,reason,retired_at&order=retired_at.desc');
    return rows.map((r) => ({ qrCodeNormalized: r.qr_code_normalized, originalQrCode: r.original_qr_code, buildingId: r.building_id, buildingName: r.building_name, reason: r.reason, retiredAtMs: r.retired_at }));
  }
  /** Reports whose visit started in [fromMs, toMs), or all pending ones when `pendingOnly`. */
  async loadReports({ fromMs, toMs, pendingOnly = false }) {
    const filter = pendingOnly ? 'verification_status=eq.PENDING_REVIEW' : `created_at=gte.${fromMs}&created_at=lt.${toMs}`;
    const rows = await this.getAll('sc_reports', `${filter}&select=payload,updated_at&order=created_at.desc,id.asc`, 300);
    return rows.map((r) => ({ ...r.payload, cloudUpdatedAtMs: r.updated_at }));
  }

  /** Every report of the company (for the backup), newest first. */
  async loadAllReports() {
    const rows = await this.getAll('sc_reports', 'select=payload,updated_at&order=created_at.desc,id.asc', 300);
    return rows.map((r) => ({ ...r.payload, cloudUpdatedAtMs: r.updated_at }));
  }

  // ---------- Invoices (manager-only billing book, two cloud copies like the app) ----------
  billingPath() {
    return `${this.companyId || 'default'}/reports/__manager_billing__/billing.json`.split('/').map(encodeURIComponent).join('/');
  }
  /** Returns {row, book, safeToWrite}; `book` is null when the phone never synced invoices. */
  async loadBilling() {
    const missing = (e) => e.status === 404 || e.status === 400 || e.code === '42P01' || e.code === 'PGRST205';
    const [rows, storageBook] = await Promise.all([
      this.req('GET', `/rest/v1/sc_billing?company_id=eq.${this.cid()}&select=payload,updated_at&limit=1`).catch((e) => { if (missing(e)) return []; throw e; }),
      this.req('GET', `/storage/v1/object/authenticated/${BUCKET}/${this.billingPath()}`).catch((e) => { if (missing(e)) return null; throw e; }),
    ]);
    const row = rows?.[0] || null;
    return { row, ...pickCloudBook(row, storageBook && typeof storageBook === 'object' ? storageBook : null) };
  }
  /**
   * Writes a changed book only if nobody saved the table copy since `row` was read (compare-and-set on
   * updated_at); then refreshes the storage copy like the app's push. Returns 'ok' or 'conflict'.
   */
  async saveBilling(book, row) {
    const ts = Math.max(Date.now(), book.updatedAtMs || 0);
    const stamped = { ...book, updatedAtMs: ts };
    const body = { payload: stamped, updated_at: ts, last_op_id: opId('web-bill', 'book') };
    if (row) {
      const res = await this.req('PATCH', `/rest/v1/sc_billing?company_id=eq.${this.cid()}&updated_at=eq.${row.updated_at}&select=updated_at`,
        { body, prefer: 'return=representation' });
      if (!Array.isArray(res) || res.length === 0) return 'conflict';
    } else {
      try {
        await this.req('POST', '/rest/v1/sc_billing', { body: { company_id: this.companyId || 'default', ...body }, prefer: 'return=minimal' });
      } catch (e) {
        if (e.status === 409) return 'conflict';
        throw e;
      }
    }
    // The table copy is newer now; a failed storage refresh is healed by the phone's next merge.
    await this.req('POST', `/storage/v1/object/${BUCKET}/${this.billingPath()}`, { body: stamped, headers: { 'x-upsert': 'true' } }).catch(() => {});
    return 'ok';
  }

  // ---------- Files ----------
  async signedUrls(paths, expiresIn = 3600) {
    const clean = [...new Set(paths.filter(Boolean))];
    if (!clean.length) return {};
    const rows = await this.req('POST', `/storage/v1/object/sign/${BUCKET}`, { body: { expiresIn, paths: clean } });
    const out = {};
    for (const r of rows || []) {
      if (r.signedURL && !r.error) out[r.path] = r.signedURL.startsWith('http') ? r.signedURL : `${this.url}/storage/v1${r.signedURL.startsWith('/') ? '' : '/'}${r.signedURL}`;
    }
    return out;
  }
  async deleteFiles(paths) {
    const clean = paths.filter(Boolean);
    if (clean.length) await this.req('DELETE', `/storage/v1/object/${BUCKET}`, { body: { prefixes: clean } }).catch(() => {});
  }

  // ---------- Writes (same RPCs as the app's SyncEngine) ----------
  saveBuilding(b, expected, sortOrder) {
    const { _sort, ...payload } = b;
    return this.cas('sc_upsert_building_cas', {
      p_id: b.id, p_qr_code: String(b.qrCode).trim(), p_sort_order: sortOrder, p_payload: payload,
      p_expected_updated_at: expected, p_op_id: opId('web-bldg', b.id),
    });
  }
  retireQr(buildingId, qr, replacement, expected) {
    return this.cas('sc_retire_building_qr_cas', {
      p_building_id: buildingId, p_qr_to_retire: qr, p_replacement_qr: replacement || '', p_reason: 'manual_retire',
      p_expected_updated_at: expected, p_op_id: opId('web-retire', buildingId),
    });
  }
  saveWorker(w, expected, { pinHash = '', clearPin = false } = {}) {
    return this.cas('sc_upsert_worker_cas', {
      p_id: w.id, p_worker_code: w.workerCode.trim(), p_name: w.name.trim(), p_preferred_lang: w.preferredLangCode || 'de',
      p_phone: (w.phone || '').trim(), p_active: !!w.active, p_worker_pin_hash: pinHash, p_clear_pin: clearPin,
      p_expected_updated_at: expected, p_op_id: opId('web-wrk', w.id),
    });
  }
  saveIssue(i, expected) {
    return this.cas('sc_upsert_issue_cas', {
      p_id: i.id, p_building_id: i.buildingId, p_status: i.status, p_assigned_worker_code: i.assignedWorkerCode || '',
      p_payload: i, p_expected_updated_at: expected, p_op_id: opId('web-iss', i.id),
    });
  }
  reviewReport(reportId, fields, expected) {
    return this.cas('sc_upsert_report_cas', {
      p_id: reportId, p_payload: fields, p_expected_updated_at: expected, p_op_id: opId('web-rev', reportId), p_review_only: true,
    });
  }
  saveCompany(payload, expected, ownerPinHash = '') {
    return this.cas('sc_upsert_company_cas', {
      p_payload: payload, p_owner_pin_hash: ownerPinHash, p_expected_updated_at: expected, p_op_id: opId('web-co', 'company'),
    });
  }
  deleteEntity(type, id, expected) {
    return this.cas('sc_delete_entity_cas', { p_entity_type: type, p_entity_id: id, p_expected_updated_at: expected, p_op_id: opId('web-del', id) });
  }
  createInvite({ workerId = '', workerCode = '', tokenHash, type = 'personal', replaceExisting = false, ttlSeconds = 604800 }) {
    return this.rpc('sc_create_worker_invite', {
      p_company_id: this.companyId, p_worker_id: type === 'shared_station' ? '' : workerId, p_worker_code: type === 'shared_station' ? '' : workerCode,
      p_token_hash: tokenHash, p_ttl_seconds: ttlSeconds, p_replace_existing: replaceExisting, p_invite_type: type,
    });
  }
  revokeDevice(workerId) {
    return this.rpc('sc_revoke_worker_device', { p_company_id: this.companyId, p_worker_id: workerId });
  }
}

function opId(prefix, id) {
  return `${prefix}-${id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
