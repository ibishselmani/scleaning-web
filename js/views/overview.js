import { html, Pill } from '../ui.js?v=70853fc885';
import { todayStatus, toUtcDate } from '../model.js?v=70853fc885';

export function Overview({ ctx }) {
  const { data, t, setView, lang } = ctx;
  const today = toUtcDate(new Date());
  const rows = todayStatus(data.buildings, data.today, today).sort((a, b) => (a.done >= a.required) - (b.done >= b.required));
  const done = rows.filter((r) => r.done >= r.required).length;
  const openIssues = data.issues.filter((i) => i.status !== 'RESOLVED');
  const workerName = (code) => data.workers.find((w) => w.workerCode.toLowerCase() === String(code).toLowerCase())?.name || code;
  const monthDone = data.monthReports.length;

  return html`<div>
    <div class="top"><h1>${t('nav.overview')}</h1>
      <span class="muted">${new Date().toLocaleDateString(lang, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</span></div>
    <div class="kpis">
      <button class="kpi" onClick=${() => setView('buildings')}><b>${done} / ${rows.length}</b><small>${t('ov.todayDone')}</small></button>
      <button class="kpi" onClick=${() => setView('reports')}><b>${data.pending.length}</b><small>${t('ov.toReview')}</small></button>
      <button class="kpi" onClick=${() => setView('issues')}><b>${openIssues.length}</b><small>${t('ov.openIssues')}</small></button>
      <button class="kpi" onClick=${() => setView('reports')}><b>${monthDone}</b><small>${t('ov.visitsMonth')}</small></button>
    </div>
    <div class="grid2">
      <section class="card">
        <h2>${t('ov.today')}</h2>
        ${rows.length === 0 ? html`<p class="muted">${t('ov.nothingToday')}</p>` : html`<table>
          <thead><tr><th>${t('b.name')}</th><th>${t('b.workers')}</th><th>${t('ov.visits')}</th></tr></thead>
          <tbody>${rows.map((r) => html`<tr>
            <td><b>${r.building.name}</b><br /><small class="muted">${r.building.address}</small></td>
            <td>${r.workers.length ? r.workers.map(workerName).join(', ') : html`<span class="muted">${t('b.allWorkers')}</span>`}</td>
            <td><${Pill} kind=${r.done >= r.required ? 'ok' : 'warn'}>${r.done} / ${r.required}<//></td>
          </tr>`)}</tbody></table>`}
      </section>
      <section class="card">
        <h2>${t('ov.openIssues')}</h2>
        ${openIssues.length === 0 ? html`<p class="muted">${t('iss.none')}</p>` : html`<ul class="plain">
          ${openIssues.slice(0, 8).map((i) => html`<li><b>${i.title}</b> · ${i.buildingName || data.buildings.find((b) => b.id === i.buildingId)?.name || ''}
            <${Pill} kind=${i.status === 'OPEN' ? 'warn' : 'info'}>${t(`iss.${i.status}`)}<//></li>`)}
        </ul>`}
        ${data.pending.length > 0 && html`<p><button class="btn" onClick=${() => setView('reports')}>${t('ov.reviewNow', data.pending.length)}</button></p>`}
      </section>
    </div>
  </div>`;
}
