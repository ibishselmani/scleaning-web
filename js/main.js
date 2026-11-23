import { render, useState, useEffect, useCallback, useMemo } from '../vendor/preact-htm.module.js?v=70853fc885';
import { html, Field, Input, Toggle, Select } from './ui.js?v=70853fc885';
import { Cloud, loadProjectConfig, saveProjectConfig } from './api.js?v=70853fc885';
import { makeT, LANGS, savedLang, saveLang } from './i18n.js?v=70853fc885';
import { Overview } from './views/overview.js?v=70853fc885';
import { Buildings } from './views/buildings.js?v=70853fc885';
import { Workers } from './views/workers.js?v=70853fc885';
import { Reports } from './views/reports.js?v=70853fc885';
import { Issues } from './views/issues.js?v=70853fc885';
import { Invoices } from './views/invoices.js?v=70853fc885';
import { Company } from './views/company.js?v=70853fc885';
import { Templates } from './views/templates.js?v=70853fc885';

const VIEWS = ['overview', 'buildings', 'workers', 'reports', 'invoices', 'issues', 'templates', 'company'];
const REFRESH_MS = 60000;
// Simple line icons for the menu (24px grid, drawn with the text colour).
const ICONS = {
  overview: 'M4 4h6v6H4z M14 4h6v6h-6z M4 14h6v6H4z M14 14h6v6h-6z',
  buildings: 'M4 21V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v16 M15 9h4a1 1 0 0 1 1 1v11 M3 21h18 M8 8h3 M8 12h3 M8 16h3',
  workers: 'M16 20v-1.5A3.5 3.5 0 0 0 12.5 15h-5A3.5 3.5 0 0 0 4 18.5V20 M10 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z M20 20v-1.5a3.5 3.5 0 0 0-2.5-3.35 M15.5 4.2a3.5 3.5 0 0 1 0 6.6',
  reports: 'M9 3.5h6a1 1 0 0 1 1 1V6H8V4.5a1 1 0 0 1 1-1z M16 5h2a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h2 M9 14l2 2 4-4',
  invoices: 'M6 3h12v18l-3-2-3 2-3-2-3 2z M9 8h6 M9 12h6 M9 16h3',
  issues: 'M12 4 2.5 20h19z M12 10v4 M12 17h.01',
  templates: 'M10 6h10 M10 12h10 M10 18h10 M4 6l1 1 2-2 M4 12l1 1 2-2 M4 18l1 1 2-2',
  company: 'M4 8h16v11H4z M9 8V6a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2 M4 13h16',
};
const NavIcon = ({ name }) => html`<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d=${ICONS[name]} /></svg>`;

function monthRange(ym) {
  const [y, m] = ym.split('-').map(Number);
  return { fromMs: new Date(y, m - 1, 1).getTime(), toMs: new Date(y, m, 1).getTime() };
}
const currentMonth = () => new Date().toISOString().slice(0, 7);

function Login({ t, project, onDone }) {
  const [url, setUrl] = useState(project?.url || '');
  const [key, setKey] = useState(project?.key || '');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showProject, setShowProject] = useState(!project);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!/^https:\/\//.test(url.trim()) && !/^http:\/\/(127\.0\.0\.1|localhost)/.test(url.trim())) {
      setError(t('err.url'));
      return;
    }
    setBusy(true);
    try {
      const cfg = { url: url.trim(), key: key.trim() };
      const cloud = new Cloud(cfg);
      await cloud.signIn(email, password, remember);
      saveProjectConfig(cfg);
      onDone(cloud);
    } catch (err) {
      setError(err.message === 'not_manager' ? t('err.notManager') : err.message === 'network' ? t('err.network') : t('err.login', err.message));
    } finally {
      setBusy(false);
    }
  };

  return html`<div class="login-wrap"><form class="card login" onSubmit=${submit}>
    <div class="brand big">S<span>Cleaning</span> Web</div>
    <p class="muted">${t('login.intro')}</p>
    ${showProject
      ? html`<${Field} label=${t('login.url')} hint=${t('login.urlHint')}><${Input} value=${url} onInput=${setUrl} placeholder="https://xxxx.supabase.co" required /><//>
        <${Field} label=${t('login.key')} hint=${t('login.keyHint')}><${Input} value=${key} onInput=${setKey} required /><//>`
      : html`<p class="muted small">${t('login.project')}: ${url} · <a href="#" onClick=${(e) => { e.preventDefault(); setShowProject(true); }}>${t('common.change')}</a></p>`}
    <${Field} label=${t('login.email')}><${Input} type="email" value=${email} onInput=${setEmail} autocomplete="username" required /><//>
    <${Field} label=${t('login.password')}><${Input} type="password" value=${password} onInput=${setPassword} autocomplete="current-password" required /><//>
    <${Toggle} checked=${remember} onChange=${setRemember} label=${t('login.remember')} />
    ${error && html`<div class="error">${error}</div>`}
    <button class="btn" disabled=${busy}>${busy ? t('common.wait') : t('login.submit')}</button>
  </form></div>`;
}

function App() {
  const [lang, setLang] = useState(savedLang());
  const t = useMemo(() => makeT(lang), [lang]);
  const [project] = useState(loadProjectConfig());
  const [cloud, setCloud] = useState(() => {
    const p = loadProjectConfig();
    if (!p) return null;
    const c = new Cloud(p);
    return c.signedIn && c.companyId ? c : null;
  });
  const [view, setView] = useState(() => (VIEWS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'overview'));
  const [data, setData] = useState(null);
  const [month, setMonth] = useState(currentMonth());
  const [toast, setToast] = useState(null);
  const [loadError, setLoadError] = useState('');

  const notify = useCallback((text, kind = 'ok') => {
    setToast({ text, kind });
    setTimeout(() => setToast(null), kind === 'err' ? 7000 : 3500);
  }, []);

  const reload = useCallback(async () => {
    if (!cloud) return;
    try {
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
      const [company, buildings, workers, issues, retired, monthReports, pending, today] = await Promise.all([
        cloud.loadCompany(),
        cloud.loadBuildings(),
        cloud.loadWorkers(),
        cloud.loadIssues(),
        cloud.loadRetired(),
        cloud.loadReports(monthRange(month)),
        cloud.loadReports({ pendingOnly: true }),
        cloud.loadReports({ fromMs: todayStart - 86400000, toMs: todayStart + 2 * 86400000 }),
      ]);
      setData({ company: company || {}, buildings, workers, issues, retired, monthReports, pending, today, loadedAt: Date.now() });
      setLoadError('');
    } catch (err) {
      if (err.status === 401) {
        cloud.signOut();
        setCloud(null);
        return;
      }
      setLoadError(err.message === 'network' ? t('err.network') : err.message);
    }
  }, [cloud, month, t]);

  useEffect(() => { reload(); }, [reload]);
  useEffect(() => {
    const id = setInterval(() => document.visibilityState === 'visible' && reload(), REFRESH_MS);
    return () => clearInterval(id);
  }, [reload]);
  useEffect(() => { if (location.hash.slice(1) !== view) location.hash = view; }, [view]);
  useEffect(() => {
    const onHash = () => {
      const v = location.hash.slice(1);
      if (VIEWS.includes(v)) setView(v);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);

  /** Shows the right message for a CAS result; returns true when the write was accepted. */
  const handleCas = useCallback((res, okText) => {
    const st = String(res?.status || '').toLowerCase();
    if (st === 'ok' || st === 'idempotent') {
      if (okText) notify(okText);
      reload();
      return true;
    }
    const detail = res?.conflict_detail || '';
    const key = { conflict: 'cas.conflict', deleted: 'cas.deleted', duplicate_qr: 'cas.duplicateQr', retired_qr: 'cas.retiredQr' }[st]
      || (detail === 'qr_immutable_use_alias_or_retire' ? 'cas.qrImmutable' : 'cas.invalid');
    notify(t(key, detail), 'err');
    reload();
    return false;
  }, [notify, reload, t]);

  const run = useCallback(async (fn) => {
    try {
      return await fn();
    } catch (err) {
      notify(err.message === 'network' ? t('err.network') : t('err.generic', err.message), 'err');
      return null;
    }
  }, [notify, t]);

  if (!cloud) {
    return html`<${Login} t=${t} project=${project} onDone=${(c) => { setCloud(c); setData(null); }} />
      <div class="lang-corner"><${Select} value=${lang} onChange=${(l) => { saveLang(l); setLang(l); }} options=${LANGS} /></div>`;
  }

  const counts = data && {
    buildings: data.buildings.length,
    workers: data.workers.filter((w) => w.active).length,
    reports: data.pending.length,
    issues: data.issues.filter((i) => i.status !== 'RESOLVED').length,
  };
  const ctx = { cloud, data, reload, t, lang, notify, handleCas, run, month, setMonth, setView,
    actor: data?.company?.ownerName?.trim() || t('common.manager') };
  const View = { overview: Overview, buildings: Buildings, workers: Workers, reports: Reports, invoices: Invoices, issues: Issues, company: Company, templates: Templates }[view];

  return html`<div class="app">
    <nav class="side">
      <div class="brand">S<span>Cleaning</span> Web</div>
      ${VIEWS.map((v) => html`<a href=${`#${v}`} class=${view === v ? 'on' : ''} onClick=${(e) => { e.preventDefault(); setView(v); }}>
        <${NavIcon} name=${v} /><span class="lbl-nav">${t(`nav.${v}`)}</span>${counts && counts[v] ? html`<span class=${v === 'issues' || v === 'reports' ? 'badge' : 'count'}>${counts[v]}</span>` : null}
      </a>`)}
      <div class="side-foot">
        <div class="co">${data?.company?.companyName || cloud.companyName || ''}</div>
        <div class="muted small">${cloud.email}</div>
        <div class="side-actions">
          <${Select} value=${lang} onChange=${(l) => { saveLang(l); setLang(l); }} options=${LANGS} />
          <button class="btn ghost small" onClick=${() => { cloud.signOut(); setCloud(null); }}>${t('common.signOut')}</button>
        </div>
        <div class="muted small">${data ? t('common.updated', new Date(data.loadedAt).toLocaleTimeString(lang)) : ''}
          <button class="link" onClick=${reload}>${t('common.refresh')}</button></div>
      </div>
    </nav>
    <main class="main">
      ${loadError && html`<div class="error">${t('err.load', loadError)}</div>`}
      ${data ? html`<${View} ctx=${ctx} />` : html`<div class="loading">${t('common.loading')}</div>`}
    </main>
    ${toast && html`<div class=${`toast ${toast.kind}`} role="status">${toast.text}</div>`}
  </div>`;
}

render(html`<${App} />`, document.getElementById('app'));
