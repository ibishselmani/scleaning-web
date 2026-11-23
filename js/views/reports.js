import { useState, useEffect } from '../../vendor/preact-htm.module.js';
import { html, Field, Select, TextArea, Pill, usePrint, downloadText, logoSrc } from '../ui.js';
import { reviewFields, parseGps, csvEscape } from '../model.js';
import { useAppData } from '../data.js';

const STATUS_KIND = { PENDING_REVIEW: 'warn', VERIFIED: 'ok', FLAGGED: 'bad' };
const fmtDur = (m) => `${Math.floor((m || 0) / 60)} h ${String((m || 0) % 60).padStart(2, '0')}`;

export function Reports({ ctx }) {
  const { data, t, month, setMonth, lang } = ctx;
  const [status, setStatus] = useState('ALL');
  const [buildingId, setBuildingId] = useState('');
  const [worker, setWorker] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [printView, print] = usePrint();

  // Pending reviews from earlier months are listed too, so nothing waiting is hidden by the month filter.
  const source = status === 'PENDING_REVIEW' ? data.pending : data.monthReports;
  const list = source.filter((r) => (status === 'ALL' || r.verificationStatus === status)
    && (!buildingId || r.buildingId === buildingId)
    && (!worker || r.workerCode === worker));
  const selected = list.find((r) => r.id === selectedId) || data.pending.find((r) => r.id === selectedId) || data.monthReports.find((r) => r.id === selectedId);
  const pendingVisible = list.filter((r) => r.verificationStatus === 'PENDING_REVIEW');

  const exportCsv = () => {
    const head = ['Protokoll', 'Datum', 'Check-in', 'Check-out', 'Minuten', 'Objekt', 'Adresse', 'Mitarbeiter', 'Code', 'Aufgaben erledigt', 'Fotos', 'Status', 'Prüfnotiz'];
    const rows = list.map((r) => [r.protocolNumber, new Date(r.checkInEpochMs).toLocaleDateString('de-DE'), r.checkInFormatted, r.checkOutFormatted, r.durationMinutes,
      r.buildingName, r.buildingAddress, r.cleanerName, r.workerCode, `${(r.taskSnapshots || []).filter((x) => x.completed).length}/${(r.taskSnapshots || []).length}`,
      (r.photos || []).length, t(`rep.${r.verificationStatus}`), r.reviewNote]);
    downloadText(`SCleaning-Berichte-${month}.csv`, [head, ...rows].map((row) => row.map(csvEscape).join(';')).join('\r\n'));
  };

  const workers = [...new Map(data.monthReports.map((r) => [r.workerCode, r.cleanerName])).entries()].filter(([c]) => c);

  return html`<div>
    <div class="top"><h1>${t('nav.reports')}</h1>
      <input class="in" type="month" value=${month} onInput=${(e) => e.target.value && setMonth(e.target.value)} aria-label=${t('rep.month')} />
      <${Select} value=${buildingId} onChange=${setBuildingId} options=${[['', t('rep.allBuildings')], ...data.buildings.map((b) => [b.id, b.name])]} />
      <${Select} value=${worker} onChange=${setWorker} options=${[['', t('rep.allWorkers')], ...workers.map(([c, n]) => [c, `${n} (${c})`])]} />
      <${Select} value=${status} onChange=${setStatus} options=${[['ALL', t('rep.allStatus')], ['PENDING_REVIEW', t('rep.PENDING_REVIEW')], ['VERIFIED', t('rep.VERIFIED')], ['FLAGGED', t('rep.FLAGGED')]]} />
      <button class="btn ghost" onClick=${exportCsv} disabled=${!list.length}>${t('rep.csv')}</button>
      <button class="btn ghost" onClick=${() => print(html`<${MonthSummary} ctx=${ctx} reports=${data.monthReports.filter((r) => !buildingId || r.buildingId === buildingId)} />`)}>${t('rep.monthPdf')}</button>
    </div>
    <div class="kpis small">
      <div class="kpi"><b>${data.monthReports.length}</b><small>${t('rep.inMonth')}</small></div>
      <div class="kpi"><b>${data.pending.length}</b><small>${t('ov.toReview')}</small></div>
      <div class="kpi"><b>${fmtDur(data.monthReports.reduce((s, r) => s + (r.durationMinutes || 0), 0))}</b><small>${t('rep.hours')}</small></div>
      <div class="kpi"><b>${data.monthReports.reduce((s, r) => s + (r.photos || []).length, 0)}</b><small>${t('rep.photos')}</small></div>
    </div>
    <div class="split">
      <section class="card list">
        ${pendingVisible.length > 1 && html`<div class="actions"><${BatchApprove} ctx=${ctx} reports=${pendingVisible} /></div>`}
        ${list.length === 0 ? html`<p class="muted">${t('rep.none')}</p>` : html`<table class="clickable">
          <thead><tr><th>${t('rep.date')}</th><th>${t('b.name')}</th><th>${t('rep.worker')}</th><th>${t('rep.duration')}</th><th>${t('w.status')}</th></tr></thead>
          <tbody>${list.map((r) => html`<tr class=${r.id === selectedId ? 'sel' : ''} onClick=${() => setSelectedId(r.id)}>
            <td>${new Date(r.checkInEpochMs).toLocaleString(lang, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
            <td>${r.buildingName}</td><td>${r.cleanerName}</td><td>${fmtDur(r.durationMinutes)}</td>
            <td><${Pill} kind=${STATUS_KIND[r.verificationStatus]}>${t(`rep.${r.verificationStatus}`)}<//></td></tr>`)}</tbody></table>`}
      </section>
      ${selected ? html`<${ReportDetail} key=${selected.id} ctx=${ctx} r=${selected} print=${print} onDeleted=${() => setSelectedId(null)} />`
        : html`<section class="card"><p class="muted">${t('rep.pick')}</p></section>`}
    </div>
    ${printView}
  </div>`;
}

function BatchApprove({ ctx, reports }) {
  const { t, cloud, run, actor } = ctx;
  const [busy, setBusy] = useState(false);
  const go = async () => {
    if (!confirm(t('rep.batchConfirm', reports.length))) return;
    setBusy(true);
    let ok = 0;
    for (const r of reports) {
      const res = await run(() => cloud.reviewReport(r.id, reviewFields('VERIFIED', r.reviewNote || 'Geprüft & freigegeben', actor), r.cloudUpdatedAtMs));
      if (res && ['ok', 'idempotent'].includes(String(res.status).toLowerCase())) ok++;
    }
    setBusy(false);
    ctx.notify(t('rep.batchDone', ok, reports.length), ok === reports.length ? 'ok' : 'err');
    ctx.reload();
  };
  return html`<button class="btn" disabled=${busy} onClick=${go}>${busy ? t('common.wait') : t('rep.batch', reports.length)}</button>`;
}

function useSignedMedia(cloud, r) {
  const [urls, setUrls] = useState({});
  useEffect(() => {
    let alive = true;
    const paths = [...(r.photos || []).map((p) => p.remotePath), r.signatureRemotePath];
    cloud.signedUrls(paths).then((u) => alive && setUrls(u)).catch(() => {});
    return () => { alive = false; };
  }, [r.id, r.cloudUpdatedAtMs]);
  return urls;
}

function ReportDetail({ ctx, r, print, onDeleted }) {
  const { t, cloud, run, handleCas, actor, data } = ctx;
  const appData = useAppData();
  const [note, setNote] = useState(r.reviewNote || '');
  const [busy, setBusy] = useState(false);
  const [zoom, setZoom] = useState(null);
  const urls = useSignedMedia(cloud, r);
  const gps = parseGps(r.gpsCheckInSummary);
  const issueLabel = (id) => appData.quickIssues.find((q) => q.id === id)?.labels?.[ctx.lang] || appData.quickIssues.find((q) => q.id === id)?.de || id;

  const review = async (status) => {
    setBusy(true);
    const res = await run(() => cloud.reviewReport(r.id, reviewFields(status, note || (status === 'VERIFIED' ? 'Geprüft & freigegeben' : ''), actor), r.cloudUpdatedAtMs));
    setBusy(false);
    if (res) handleCas(res, status === 'VERIFIED' ? t('rep.approved') : status === 'FLAGGED' ? t('rep.flagged') : t('saved'));
  };
  const remove = async () => {
    if (!confirm(t('rep.deleteConfirm', r.protocolNumber))) return;
    const res = await run(() => cloud.deleteEntity('REPORT', r.id, r.cloudUpdatedAtMs));
    if (res && handleCas(res, t('deleted'))) {
      cloud.deleteFiles([...(r.photos || []).map((p) => p.remotePath), r.signatureRemotePath]);
      onDeleted();
    }
  };

  return html`<section class="card editor">
    <div class="editor-head"><h2>${r.buildingName}</h2><${Pill} kind=${STATUS_KIND[r.verificationStatus]}>${t(`rep.${r.verificationStatus}`)}<//></div>
    <p class="muted">${t('rep.protocol')} ${r.protocolNumber} · ${r.cleanerName} (${r.workerCode}) ·
      ${r.checkInFormatted} – ${r.checkOutFormatted.split(' ').pop()} · ${fmtDur(r.durationMinutes)} ·
      ${r.checkInMethod === 'QR_VERIFIED' ? t('rep.viaQr') : t('rep.manual')}
      ${gps && html` · <a href=${`https://www.openstreetmap.org/?mlat=${gps.lat}&mlon=${gps.lon}#map=18/${gps.lat}/${gps.lon}`} target="_blank" rel="noopener noreferrer">${t('rep.gps')}</a>`}</p>
    ${(r.photos || []).length > 0 && html`<div class="photos">${r.photos.map((p) => html`<figure>
      ${urls[p.remotePath] ? html`<img src=${urls[p.remotePath]} alt=${p.captionDe} loading="lazy" onClick=${() => setZoom(urls[p.remotePath])} />` : html`<div class="ph-missing">${p.remotePath ? '…' : t('rep.photoLocal')}</div>`}
      <figcaption>${p.captionDe}</figcaption></figure>`)}</div>`}
    <h3>${t('b.tasks')} (${(r.taskSnapshots || []).filter((x) => x.completed).length}/${(r.taskSnapshots || []).length})</h3>
    <ul class="checks">${(r.taskSnapshots || []).map((x) => html`<li class=${x.completed ? 'done' : 'open'}>${x.completed ? '✓' : '○'} <b>${x.areaDe}:</b> ${x.labelDe}${x.completed || x.required === false ? '' : html` <${Pill} kind="bad">${t('rep.notDone')}<//>`}</li>`)}</ul>
    ${(r.selectedIssueIds || []).length > 0 && html`<h3>${t('rep.reported')}</h3><div class="chips">${r.selectedIssueIds.map((id) => html`<span class="chip">${issueLabel(id)}</span>`)}</div>`}
    ${r.cleanerNotes && html`<h3>${t('rep.notes')}</h3><p class="pre">${r.cleanerNotes}</p>`}
    ${r.signatureRemotePath && html`<h3>${t('rep.signature')}</h3>${urls[r.signatureRemotePath] ? html`<img class="sig" src=${urls[r.signatureRemotePath]} alt=${t('rep.signature')} />` : '…'}`}
    ${r.verifiedBy && html`<p class="muted small">${t('rep.reviewedBy', r.verifiedBy, r.verifiedAtFormatted)}</p>`}
    <${Field} label=${t('rep.reviewNote')} wide><${TextArea} rows="2" value=${note} onInput=${setNote} /><//>
    <div class="actions">
      <button class="btn danger ghost" onClick=${remove}>${t('common.delete')}</button>
      <span class="grow"></span>
      <button class="btn ghost" onClick=${() => print(html`<${ReportPrint} r=${r} urls=${urls} company=${data.company} issueLabel=${issueLabel} />`)}>${t('rep.print')}</button>
      <button class="btn ghost danger" disabled=${busy} onClick=${() => review('FLAGGED')}>${t('rep.flag')}</button>
      <button class="btn ok" disabled=${busy} onClick=${() => review('VERIFIED')}>✓ ${t('rep.approve')}</button>
    </div>
    ${zoom && html`<div class="overlay" onClick=${() => setZoom(null)}><img class="zoom" src=${zoom} alt="" /></div>`}
  </section>`;
}

/** Printable German report (counterpart of GermanPdfGenerator.generateGermanReportPdf). */
function ReportPrint({ r, urls, company, issueLabel }) {
  return html`<div class="doc">
    <div class="doc-head"><div><h1>Reinigungsprotokoll</h1><div>${company.companyName}<br />${company.streetAddress} · ${company.postalCity}</div></div>
      ${company.logoBase64 && html`<img class="doc-logo" src=${logoSrc(company.logoBase64)} alt="" />`}</div>
    <table class="doc-table">
      <tr><th>Protokoll-Nr.</th><td>${r.protocolNumber}</td><th>Status</th><td>${{ PENDING_REVIEW: 'In Prüfung', VERIFIED: 'Geprüft & freigegeben', FLAGGED: 'Beanstandet' }[r.verificationStatus]}</td></tr>
      <tr><th>Objekt</th><td>${r.buildingName}<br />${r.buildingAddress}</td><th>Auftraggeber</th><td>${r.clientName}<br />Vertrag: ${r.contractNumber || '—'}</td></tr>
      <tr><th>Reinigungskraft</th><td>${r.cleanerName} (${r.workerCode})</td><th>Zeitraum</th><td>${r.checkInFormatted} – ${r.checkOutFormatted} (${fmtDur(r.durationMinutes)})</td></tr>
      <tr><th>Check-in</th><td>${r.checkInMethod === 'QR_VERIFIED' ? 'QR-Code am Objekt' : 'Manuell'}</td><th>GPS</th><td>${r.gpsCheckInSummary || '—'}</td></tr>
    </table>
    <h2>Leistungen</h2>
    <ul class="checks">${(r.taskSnapshots || []).map((x) => html`<li>${x.completed ? '☑' : '☐'} <b>${x.areaDe}:</b> ${x.labelDe}</li>`)}</ul>
    ${(r.selectedIssueIds || []).length > 0 && html`<h2>Hinweise</h2><p>${r.selectedIssueIds.map((id) => issueLabel(id)).join(' · ')}</p>`}
    ${r.cleanerNotes && html`<h2>Bemerkungen</h2><p class="pre">${r.cleanerNotes}</p>`}
    ${(r.photos || []).some((p) => urls[p.remotePath]) && html`<h2>Fotonachweis</h2><div class="doc-photos">
      ${r.photos.filter((p) => urls[p.remotePath]).map((p) => html`<figure><img src=${urls[p.remotePath]} alt="" /><figcaption>${p.captionDe} ${p.timestamp}</figcaption></figure>`)}</div>`}
    ${urls[r.signatureRemotePath] && html`<h2>Unterschrift</h2><img class="sig" src=${urls[r.signatureRemotePath]} alt="" />`}
    ${r.verifiedBy && html`<p>Geprüft von ${r.verifiedBy} am ${r.verifiedAtFormatted}${r.reviewNote ? ` – ${r.reviewNote}` : ''}</p>`}
    <p class="doc-foot">${company.invoiceFooterText || ''}</p>
  </div>`;
}

/** Monthly overview per building for clients (counterpart of generateMonthlyClientSummaryPdf). */
function MonthSummary({ ctx, reports }) {
  const { data, month } = ctx;
  const byBuilding = new Map();
  for (const r of reports) (byBuilding.get(r.buildingId) || byBuilding.set(r.buildingId, []).get(r.buildingId)).push(r);
  const [y, m] = month.split('-');
  return html`<div class="doc">
    <div class="doc-head"><div><h1>Monatsübersicht ${m}/${y}</h1><div>${data.company.companyName}</div></div>
      ${data.company.logoBase64 && html`<img class="doc-logo" src=${logoSrc(data.company.logoBase64)} alt="" />`}</div>
    ${[...byBuilding.values()].map((list) => html`<div class="doc-block">
      <h2>${list[0].buildingName}</h2><p>${list[0].buildingAddress} · Auftraggeber: ${list[0].clientName}</p>
      <table class="doc-table"><tr><th>Datum</th><th>Zeit</th><th>Dauer</th><th>Reinigungskraft</th><th>Leistungen</th><th>Status</th></tr>
        ${list.slice().sort((a, b) => a.checkInEpochMs - b.checkInEpochMs).map((r) => html`<tr>
          <td>${new Date(r.checkInEpochMs).toLocaleDateString('de-DE')}</td><td>${r.checkInFormatted.split(' ').pop()}–${r.checkOutFormatted.split(' ').pop()}</td>
          <td>${fmtDur(r.durationMinutes)}</td><td>${r.cleanerName}</td>
          <td>${(r.taskSnapshots || []).filter((x) => x.completed).length}/${(r.taskSnapshots || []).length}</td>
          <td>${{ PENDING_REVIEW: 'In Prüfung', VERIFIED: 'Freigegeben', FLAGGED: 'Beanstandet' }[r.verificationStatus]}</td></tr>`)}
      </table><p>Einsätze: ${list.length} · Gesamtdauer: ${fmtDur(list.reduce((s, r) => s + (r.durationMinutes || 0), 0))}</p></div>`)}
    ${byBuilding.size === 0 && html`<p>Keine Einsätze in diesem Monat.</p>`}
  </div>`;
}
