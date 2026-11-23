import { useState } from '../../vendor/preact-htm.module.js?v=30db8cbe75';
import { html, Field, Input, TextArea, Select, Modal, Pill } from '../ui.js?v=30db8cbe75';
import { newIssue, applyIssueUpdate } from '../model.js?v=30db8cbe75';

const KIND = { OPEN: 'warn', IN_PROGRESS: 'info', RESOLVED: 'ok' };

export function Issues({ ctx }) {
  const { data, t, lang } = ctx;
  const [filter, setFilter] = useState('ACTIVE');
  const [editing, setEditing] = useState(null);
  const list = data.issues
    .filter((i) => (filter === 'ACTIVE' ? i.status !== 'RESOLVED' : filter === 'ALL' || i.status === filter))
    .sort((a, b) => (b.updatedAtMs || 0) - (a.updatedAtMs || 0));
  const bName = (i) => i.buildingName || data.buildings.find((b) => b.id === i.buildingId)?.name || '—';
  const wName = (code) => data.workers.find((w) => w.workerCode === code)?.name || code;

  return html`<div>
    <div class="top"><h1>${t('nav.issues')}</h1>
      <${Select} value=${filter} onChange=${setFilter} options=${[['ACTIVE', t('iss.active')], ['OPEN', t('iss.OPEN')], ['IN_PROGRESS', t('iss.IN_PROGRESS')], ['RESOLVED', t('iss.RESOLVED')], ['ALL', t('iss.all')]]} />
      <button class="btn" onClick=${() => setEditing({})} disabled=${!data.buildings.length}>+ ${t('iss.new')}</button></div>
    <section class="card">
      ${list.length === 0 ? html`<p class="muted">${t('iss.none')}</p>` : html`<table class="clickable">
        <thead><tr><th>${t('iss.title')}</th><th>${t('b.name')}</th><th>${t('iss.reportedBy')}</th><th>${t('iss.assigned')}</th><th>${t('w.status')}</th><th>${t('iss.updated')}</th></tr></thead>
        <tbody>${list.map((i) => html`<tr onClick=${() => setEditing(i)}>
          <td><b>${i.title}</b>${i.description ? html`<br /><small class="muted">${i.description}</small>` : null}</td>
          <td>${bName(i)}</td><td>${i.reportedByName}</td><td>${i.assignedWorkerCode ? wName(i.assignedWorkerCode) : '—'}</td>
          <td><${Pill} kind=${KIND[i.status]}>${t(`iss.${i.status}`)}<//></td>
          <td>${i.updatedAtMs ? new Date(i.updatedAtMs).toLocaleDateString(lang) : ''}</td></tr>`)}</tbody></table>`}
    </section>
    ${editing && html`<${IssueForm} ctx=${ctx} issue=${editing.id ? editing : null} onClose=${() => setEditing(null)} />`}
  </div>`;
}

function IssueForm({ ctx, issue, onClose }) {
  const { data, t, cloud, run, handleCas, actor } = ctx;
  const [buildingId, setBuildingId] = useState(issue?.buildingId || data.buildings[0]?.id || '');
  const [title, setTitle] = useState(issue?.title || '');
  const [description, setDescription] = useState(issue?.description || '');
  const [status, setStatus] = useState(issue?.status || 'OPEN');
  const [assigned, setAssigned] = useState(issue?.assignedWorkerCode || '');
  const [note, setNote] = useState(issue?.resolutionNote || '');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!title.trim()) return ctx.notify(t('iss.titleRequired'), 'err');
    const b = data.buildings.find((x) => x.id === buildingId);
    const base = issue || newIssue({ buildingId, buildingName: b?.name || '', title, description, assignedWorkerCode: assigned }, actor);
    const next = applyIssueUpdate({ ...base, buildingId, buildingName: b?.name || base.buildingName, title: title.trim(), description: description.trim() },
      { status, resolutionNote: note, assignedWorkerCode: assigned }, actor);
    setBusy(true);
    const res = await run(() => cloud.saveIssue(next, issue ? issue.cloudUpdatedAtMs || issue.updatedAtMs : 0));
    setBusy(false);
    if (res && handleCas(res, t('saved'))) onClose();
  };
  const remove = async () => {
    if (!confirm(t('iss.deleteConfirm', issue.title))) return;
    const res = await run(() => cloud.deleteEntity('ISSUE', issue.id, issue.cloudUpdatedAtMs || issue.updatedAtMs));
    if (res && handleCas(res, t('deleted'))) onClose();
  };

  return html`<${Modal} title=${issue ? t('iss.edit') : t('iss.new')} onClose=${onClose}>
    <div class="form two">
      <${Field} label=${t('b.name')}><${Select} value=${buildingId} onChange=${setBuildingId} options=${data.buildings.map((b) => [b.id, b.name])} /><//>
      <${Field} label=${t('iss.assigned')}><${Select} value=${assigned} onChange=${setAssigned} options=${[['', '—'], ...data.workers.filter((w) => w.active).map((w) => [w.workerCode, `${w.name} (${w.workerCode})`])]} /><//>
      <${Field} label=${t('iss.title')} wide><${Input} value=${title} onInput=${setTitle} /><//>
      <${Field} label=${t('iss.description')} wide><${TextArea} value=${description} onInput=${setDescription} /><//>
      <${Field} label=${t('w.status')}><${Select} value=${status} onChange=${setStatus} options=${['OPEN', 'IN_PROGRESS', 'RESOLVED'].map((s) => [s, t(`iss.${s}`)])} /><//>
      ${status === 'RESOLVED' && html`<${Field} label=${t('iss.resolution')}><${Input} value=${note} onInput=${setNote} /><//>`}
    </div>
    ${issue?.sourceReportId && html`<p class="muted small">${t('iss.fromReport')}</p>`}
    <div class="actions">
      ${issue && html`<button class="btn danger ghost" onClick=${remove}>${t('common.delete')}</button>`}
      <span class="grow"></span>
      <button class="btn ghost" onClick=${onClose}>${t('common.cancel')}</button>
      <button class="btn" disabled=${busy} onClick=${save}>${busy ? t('common.wait') : t('common.save')}</button></div>
  <//>`;
}
