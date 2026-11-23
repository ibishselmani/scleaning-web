import { useState } from '../../vendor/preact-htm.module.js?v=30db8cbe75';
import { html, Field, Input, Toggle, Modal } from '../ui.js?v=30db8cbe75';
import { newTemplate, instantiateTasks } from '../model.js?v=30db8cbe75';
import { TaskEditor } from './tasks.js?v=30db8cbe75';
import { saveCompanyProfile } from './company.js?v=30db8cbe75';

const DAYS = [1, 2, 3, 4, 5, 6, 7];

export function Templates({ ctx }) {
  const { data, t } = ctx;
  const templates = data.company.customChecklistTemplates || [];
  const [editing, setEditing] = useState(null);
  const [applying, setApplying] = useState(null);

  const remove = async (tpl) => {
    if (!confirm(t('tpl.deleteConfirm', tpl.name))) return;
    await saveCompanyProfile(ctx, { ...data.company, customChecklistTemplates: templates.filter((x) => x.id !== tpl.id) }, t('deleted'));
  };

  return html`<div>
    <div class="top"><h1>${t('nav.templates')}</h1><button class="btn" onClick=${() => setEditing({})}>+ ${t('tpl.new')}</button></div>
    <p class="hint">${t('tpl.hint')}</p>
    <section class="card">
      ${templates.length === 0 ? html`<p class="muted">${t('tpl.none')}</p>` : html`<table>
        <thead><tr><th>${t('tpl.name')}</th><th>${t('b.tasks')}</th><th>${t('b.days')}</th><th></th></tr></thead>
        <tbody>${templates.map((tpl) => html`<tr><td><b>${tpl.name}</b></td><td>${(tpl.tasks || []).length}</td>
          <td>${(tpl.defaultScheduledDays || []).map((d) => t(`day.${d}`)).join(', ')}</td>
          <td class="row-actions"><button class="link" onClick=${() => setEditing(tpl)}>${t('common.edit')}</button>
            <button class="link" onClick=${() => setApplying(tpl)}>${t('tpl.apply')}</button>
            <button class="link danger" onClick=${() => remove(tpl)}>${t('common.delete')}</button></td></tr>`)}</tbody></table>`}
    </section>
    ${editing && html`<${TemplateForm} ctx=${ctx} tpl=${editing.id ? editing : null} onClose=${() => setEditing(null)} />`}
    ${applying && html`<${ApplyTemplate} ctx=${ctx} tpl=${applying} onClose=${() => setApplying(null)} />`}
  </div>`;
}

function TemplateForm({ ctx, tpl, onClose }) {
  const { data, t, lang } = ctx;
  const [d, setD] = useState(tpl || newTemplate({ name: '' }));
  const [busy, setBusy] = useState(false);
  const set = (patch) => setD((cur) => ({ ...cur, ...patch }));
  const save = async () => {
    if (!d.name.trim()) return ctx.notify(t('tpl.nameRequired'), 'err');
    setBusy(true);
    const clean = { ...d, name: d.name.trim(), updatedAtMs: Date.now() };
    const list = (data.company.customChecklistTemplates || []).filter((x) => x.id !== clean.id);
    const ok = await saveCompanyProfile(ctx, { ...data.company, customChecklistTemplates: [...list, clean] }, t('saved'));
    setBusy(false);
    if (ok) onClose();
  };
  const toggleDay = (day) => set({ defaultScheduledDays: d.defaultScheduledDays.includes(day) ? d.defaultScheduledDays.filter((x) => x !== day) : [...d.defaultScheduledDays, day].sort() });
  return html`<${Modal} wide title=${tpl ? t('tpl.edit') : t('tpl.new')} onClose=${onClose}>
    <div class="form two">
      <${Field} label=${t('tpl.name')}><${Input} value=${d.name} onInput=${(v) => set({ name: v })} autofocus /><//>
      <${Field} label=${t('b.days')}><div class="days">${DAYS.map((day) => html`<button class=${`day${d.defaultScheduledDays.includes(day) ? ' on' : ''}`} onClick=${() => toggleDay(day)}>${t(`day.${day}`)}</button>`)}</div><//>
      <${Field} label=${t('b.minPhotos')}><${Input} type="number" min="0" max="20" value=${d.defaultMinPhotos} onInput=${(v) => set({ defaultMinPhotos: Math.min(Math.max(v || 0, 0), 20) })} /><//>
      <div class="field"><${Toggle} checked=${d.defaultRequireBeforeAfter} onChange=${(v) => set({ defaultRequireBeforeAfter: v })} label=${t('b.beforeAfter')} /></div>
    </div>
    <h3>${t('b.tasks')}</h3>
    <${TaskEditor} tasks=${d.tasks} onChange=${(tasks) => set({ tasks })} t=${t} lang=${lang} />
    <div class="actions"><span class="grow"></span><button class="btn ghost" onClick=${onClose}>${t('common.cancel')}</button>
      <button class="btn" disabled=${busy} onClick=${save}>${t('common.save')}</button></div>
  <//>`;
}

function ApplyTemplate({ ctx, tpl, onClose }) {
  const { data, t, cloud, run } = ctx;
  const [ids, setIds] = useState([]);
  const [busy, setBusy] = useState(false);
  const apply = async () => {
    if (!ids.length || !confirm(t('tpl.applyConfirm', tpl.name, ids.length))) return;
    setBusy(true);
    const now = Date.now();
    let ok = 0;
    for (const b of data.buildings.filter((x) => ids.includes(x.id))) {
      const next = { ...b, tasks: instantiateTasks(tpl.tasks || [], `t-${now}-${b.id.slice(-4)}`), minPhotosRequired: tpl.defaultMinPhotos, requireBeforeAfterPhotos: tpl.defaultRequireBeforeAfter };
      const res = await run(() => cloud.saveBuilding(next, b.updatedAtMs, b._sort ?? 0));
      if (res && ['ok', 'idempotent'].includes(String(res.status).toLowerCase())) ok++;
    }
    setBusy(false);
    ctx.notify(t('tpl.applied', ok, ids.length), ok === ids.length ? 'ok' : 'err');
    ctx.reload();
    onClose();
  };
  return html`<${Modal} title=${t('tpl.applyTitle', tpl.name)} onClose=${onClose}>
    <p class="hint">${t('tpl.applyHint')}</p>
    <div class="checklist">${data.buildings.map((b) => html`<label><input type="checkbox" checked=${ids.includes(b.id)}
      onChange=${(e) => setIds(e.target.checked ? [...ids, b.id] : ids.filter((x) => x !== b.id))} /> ${b.name}</label>`)}</div>
    <div class="actions"><span class="grow"></span><button class="btn ghost" onClick=${onClose}>${t('common.cancel')}</button>
      <button class="btn" disabled=${busy || !ids.length} onClick=${apply}>${busy ? t('common.wait') : t('tpl.apply')}</button></div>
  <//>`;
}
