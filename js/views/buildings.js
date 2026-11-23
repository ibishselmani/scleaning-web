import { useState, useEffect, useRef } from '../../vendor/preact-htm.module.js?v=e23e5b5c61';
import { html, Field, Input, TextArea, Select, Toggle, Modal, QrCode, usePrint, logoSrc } from '../ui.js?v=e23e5b5c61';
import {
  newBuilding, applyBuildingEdit, nextUniqueQrCode, findQrConflict, isRetired, instantiateTasks, normalizeQr, visitsPerDay,
} from '../model.js?v=e23e5b5c61';
import { TaskEditor } from './tasks.js?v=e23e5b5c61';
import { useAppData } from '../data.js?v=e23e5b5c61';

const DAYS = [1, 2, 3, 4, 5, 6, 7];
const TIME = /^([01]?\d|2[0-3]):[0-5]\d$/;

export function Buildings({ ctx }) {
  const { data, t } = ctx;
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState(data.buildings[0]?.id || null);
  const [creating, setCreating] = useState(false);
  const [printView, print] = usePrint();
  const q = query.trim().toLowerCase();
  const list = data.buildings.filter((b) => !q || [b.name, b.address, b.clientName, b.qrCode].some((v) => String(v || '').toLowerCase().includes(q)));
  const selected = data.buildings.find((b) => b.id === selectedId);
  const workerName = (code) => data.workers.find((w) => w.workerCode.toLowerCase() === String(code).toLowerCase())?.name || code;

  return html`<div>
    <div class="top"><h1>${t('nav.buildings')}</h1>
      <input class="in search" placeholder=${t('b.search')} value=${query} onInput=${(e) => setQuery(e.target.value)} />
      <button class="btn" onClick=${() => setCreating(true)}>+ ${t('b.new')}</button></div>
    <div class="split">
      <section class="card list">
        ${list.length === 0 ? html`<p class="muted">${t('b.none')}</p>` : html`<table class="clickable">
          <thead><tr><th>${t('b.name')}</th><th>${t('b.client')}</th><th>${t('b.days')}</th><th>${t('b.workers')}</th></tr></thead>
          <tbody>${list.map((b) => html`<tr class=${b.id === selectedId ? 'sel' : ''} onClick=${() => setSelectedId(b.id)}>
            <td><b>${b.name}</b><br /><small class="muted">${b.address}</small></td>
            <td>${b.clientName}</td>
            <td>${scheduleLabel(b, t)}</td>
            <td>${(b.assignedWorkerCodes || []).length ? b.assignedWorkerCodes.map(workerName).join(', ') : html`<span class="muted">${t('b.allWorkers')}</span>`}</td>
          </tr>`)}</tbody></table>`}
      </section>
      ${selected ? html`<${BuildingEditor} key=${selected.id} ctx=${ctx} building=${selected} print=${print}
          onDeleted=${() => setSelectedId(null)} />`
        : html`<section class="card"><p class="muted">${t('b.pick')}</p></section>`}
    </div>
    ${creating && html`<${NewBuilding} ctx=${ctx} onClose=${() => setCreating(false)} onCreated=${(id) => { setCreating(false); setSelectedId(id); }} />`}
    ${printView}
  </div>`;
}

export function scheduleLabel(b, t) {
  const f = b.scheduleFrequency || 'WEEKLY';
  if (f === 'MONTHLY') return t('b.monthlyOn', b.monthlyDayOfMonth || 1);
  const days = (b.scheduledDays || []).slice().sort().map((d) => t(`day.${d}`)).join(', ');
  return f === 'BIWEEKLY' ? `${t('b.biweekly')}: ${days}` : days;
}

function NewBuilding({ ctx, onClose, onCreated }) {
  const { data, t, cloud, run, handleCas, lang } = ctx;
  const appData = useAppData();
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [clientName, setClientName] = useState('');
  const [template, setTemplate] = useState('');
  const [busy, setBusy] = useState(false);
  const create = async () => {
    if (!name.trim()) return;
    setBusy(true);
    const now = Date.now();
    let b = newBuilding({ name: name.trim(), address: address.trim(), clientName: clientName.trim() }, data.buildings, data.retired, now);
    const tpl = appData.buildingTemplates.find((x) => x.id === template);
    if (tpl) {
      const lib = tpl.taskIds.map((id) => appData.taskLibrary.find((x) => x.id === id)).filter(Boolean);
      b = { ...b, tasks: instantiateTasks(lib, `t-${now}`), scheduledDays: tpl.defaultScheduledDays, minPhotosRequired: tpl.defaultMinPhotos, requireBeforeAfterPhotos: tpl.defaultRequireBeforeAfter };
    }
    const sort = Math.max(-1, ...data.buildings.map((x) => x._sort ?? 0)) + 1;
    const res = await run(() => cloud.saveBuilding(b, 0, sort));
    setBusy(false);
    if (res && handleCas(res, t('saved'))) onCreated(b.id);
  };
  return html`<${Modal} title=${t('b.new')} onClose=${onClose}>
    <div class="form">
      <${Field} label=${t('b.name')}><${Input} value=${name} onInput=${setName} autofocus /><//>
      <${Field} label=${t('b.address')}><${Input} value=${address} onInput=${setAddress} /><//>
      <${Field} label=${t('b.client')}><${Input} value=${clientName} onInput=${setClientName} /><//>
      <${Field} label=${t('b.template')} hint=${t('b.templateHint')}>
        <${Select} value=${template} onChange=${setTemplate} options=${[['', t('b.noTemplate')], ...appData.buildingTemplates.map((x) => [x.id, x.labels[lang] || x.labels.de])]} /><//>
    </div>
    <div class="actions"><button class="btn ghost" onClick=${onClose}>${t('common.cancel')}</button>
      <button class="btn" disabled=${busy || !name.trim()} onClick=${create}>${t('common.create')}</button></div>
  <//>`;
}

function BuildingEditor({ ctx, building, print, onDeleted }) {
  const { data, t, cloud, run, handleCas, lang } = ctx;
  // `base` is the version the edit started from; saving sends its revision so a newer change elsewhere is never overwritten.
  const [base, setBase] = useState(building);
  const [d, setD] = useState(building);
  const [busy, setBusy] = useState(false);
  const [qrModal, setQrModal] = useState(false);
  const savedRef = useRef(false);
  const set = (patch) => setD((cur) => ({ ...cur, ...patch }));
  const dirty = JSON.stringify(d) !== JSON.stringify(base);
  const changedElsewhere = building.updatedAtMs !== base.updatedAtMs;
  useEffect(() => {
    if (changedElsewhere && (!dirty || savedRef.current)) {
      savedRef.current = false;
      setBase(building);
      setD(building);
    }
  }, [building.updatedAtMs]);
  useEffect(() => {
    const warn = (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const visits = visitsPerDay(d);
  const windows = Array.from({ length: visits }, (_, i) => d.shiftWindows?.[i] || { startTime: '', endTime: '' });
  const setWindow = (i, patch) => set({ shiftWindows: windows.map((w, j) => (j === i ? { ...w, ...patch } : w)) });
  const toggleDay = (day) => set({ scheduledDays: d.scheduledDays.includes(day) ? d.scheduledDays.filter((x) => x !== day) : [...d.scheduledDays, day].sort() });
  const toggleWorker = (code) => set({ assignedWorkerCodes: d.assignedWorkerCodes.includes(code) ? d.assignedWorkerCodes.filter((x) => x !== code) : [...d.assignedWorkerCodes, code] });

  const save = async () => {
    if (!d.name.trim()) return ctx.notify(t('b.nameRequired'), 'err');
    if (windows.some((w) => (w.startTime && !TIME.test(w.startTime)) || (w.endTime && !TIME.test(w.endTime)))) return ctx.notify(t('b.timeFormat'), 'err');
    const edited = applyBuildingEdit(base, { ...d, name: d.name.trim(), shiftWindows: windows.some((w) => w.startTime || w.endTime) ? windows : [] });
    const conflict = findQrConflict(edited, data.buildings);
    if (conflict) return ctx.notify(t('cas.duplicateQr', conflict.name), 'err');
    setBusy(true);
    const res = await run(() => cloud.saveBuilding(edited, base.updatedAtMs, base._sort ?? 0));
    setBusy(false);
    if (res) savedRef.current = handleCas(res, t('saved'));
  };
  const remove = async () => {
    if (!confirm(t('b.deleteConfirm', building.name))) return;
    const res = await run(() => cloud.deleteEntity('BUILDING', building.id, building.updatedAtMs));
    if (res && handleCas(res, t('deleted'))) onDeleted();
  };

  return html`<section class="card editor">
    <div class="editor-head"><h2>${building.name}</h2>
      <button class="btn ghost small" onClick=${() => setQrModal(true)}>${t('b.qr')}</button>
      <button class="btn ghost small" onClick=${() => print(html`<${Poster} b=${building} company=${data.company} />`)}>${t('b.printPoster')}</button></div>
    ${changedElsewhere && dirty && html`<div class="error">${t('common.changedElsewhere')}
      <button class="link" onClick=${() => { setBase(building); setD(building); }}>${t('common.loadNewest')}</button></div>`}

    <h3>${t('b.basics')}</h3>
    <div class="form two">
      <${Field} label=${t('b.name')}><${Input} value=${d.name} onInput=${(v) => set({ name: v })} /><//>
      <${Field} label=${t('b.address')}><${Input} value=${d.address} onInput=${(v) => set({ address: v })} /><//>
      <${Field} label=${t('b.client')}><${Input} value=${d.clientName} onInput=${(v) => set({ clientName: v })} /><//>
      <${Field} label=${t('b.contract')}><${Input} value=${d.contractNumber} onInput=${(v) => set({ contractNumber: v })} /><//>
      <${Field} label=${t('b.clientEmail')} hint=${t('b.clientEmailHint')}><${Input} type="email" value=${d.clientEmail} onInput=${(v) => set({ clientEmail: v })} /><//>
      <${Field} label=${t('b.clientPhone')}><${Input} value=${d.clientPhone} onInput=${(v) => set({ clientPhone: v })} /><//>
      <${Field} label=${t('b.access')} wide><${TextArea} rows="2" value=${d.accessHint} onInput=${(v) => set({ accessHint: v })} /><//>
      <${Field} label=${t('b.keyAlarm')} wide><${TextArea} rows="2" value=${d.keyAlarmInfo} onInput=${(v) => set({ keyAlarmInfo: v })} /><//>
    </div>

    <h3>${t('b.schedule')}</h3>
    <div class="form two">
      <${Field} label=${t('b.frequency')}><${Select} value=${d.scheduleFrequency || 'WEEKLY'} onChange=${(v) => set({ scheduleFrequency: v })}
        options=${[['WEEKLY', t('b.weekly')], ['BIWEEKLY', t('b.biweekly')], ['MONTHLY', t('b.monthly')]]} /><//>
      ${d.scheduleFrequency === 'MONTHLY'
        ? html`<${Field} label=${t('b.monthDay')}><${Input} type="number" min="1" max="31" value=${d.monthlyDayOfMonth} onInput=${(v) => set({ monthlyDayOfMonth: Math.min(Math.max(v || 1, 1), 31) })} /><//>`
        : html`<${Field} label=${t('b.days')}><div class="days">${DAYS.map((day) => html`<button class=${`day${d.scheduledDays.includes(day) ? ' on' : ''}`} onClick=${() => toggleDay(day)}>${t(`day.${day}`)}</button>`)}</div><//>`}
      ${d.scheduleFrequency === 'BIWEEKLY' && html`<${Field} label=${t('b.anchor')} hint=${t('b.anchorHint')}><${Input} type="date" value=${d.scheduleAnchorDate} onInput=${(v) => set({ scheduleAnchorDate: v })} /><//>`}
      <${Field} label=${t('b.visitsPerDay')}><${Select} value=${visits} onChange=${(v) => set({ visitsPerDay: Number(v) })} options=${[1, 2, 3, 4].map((n) => [n, String(n)])} /><//>
      <${Field} label=${t('b.timeWindows')} hint=${t('b.timeWindowsHint')} wide>
        ${windows.map((w, i) => html`<div class="row"><span class="muted">${t('b.visitN', i + 1)}</span>
          <input class="in time" type="time" value=${w.startTime} onInput=${(e) => setWindow(i, { startTime: e.target.value })} aria-label=${t('b.from')} />
          <span>–</span>
          <input class="in time" type="time" value=${w.endTime} onInput=${(e) => setWindow(i, { endTime: e.target.value })} aria-label=${t('b.to')} /></div>`)}
      <//>
    </div>

    <h3>${t('b.rules')}</h3>
    <div class="form two">
      <${Field} label=${t('b.minPhotos')}><${Input} type="number" min="0" max="20" value=${d.minPhotosRequired} onInput=${(v) => set({ minPhotosRequired: Math.min(Math.max(v || 0, 0), 20) })} /><//>
      <div class="field">
        <${Toggle} checked=${d.requireBeforeAfterPhotos} onChange=${(v) => set({ requireBeforeAfterPhotos: v })} label=${t('b.beforeAfter')} />
        <${Toggle} checked=${d.requireGpsCheckIn} onChange=${(v) => set({ requireGpsCheckIn: v })} label=${t('b.gps')} />
      </div>
    </div>

    <h3>${t('b.workers')}</h3>
    <p class="hint">${t('b.workersHint')}</p>
    <div class="chips">${data.workers.filter((w) => w.active || d.assignedWorkerCodes.includes(w.workerCode)).map((w) => html`
      <button class=${`chip${d.assignedWorkerCodes.includes(w.workerCode) ? ' on' : ''}`} onClick=${() => toggleWorker(w.workerCode)}>${w.name} (${w.workerCode})</button>`)}</div>
    <div class="form two">
      <${Field} label=${t('b.replacement')} hint=${t('b.replacementHint')}>
        <${Select} value=${d.replacementWorkerCode} onChange=${(v) => set({ replacementWorkerCode: v })}
          options=${[['', t('b.noReplacement')], ...data.workers.filter((w) => w.active).map((w) => [w.workerCode, `${w.name} (${w.workerCode})`])]} /><//>
      ${d.replacementWorkerCode && html`<${Field} label=${t('b.replacementUntil')}><${Input} type="date" value=${d.replacementUntilDate} onInput=${(v) => set({ replacementUntilDate: v })} /><//>`}
    </div>

    <h3>${t('b.tasks')}</h3>
    <${TaskEditor} tasks=${d.tasks} onChange=${(tasks) => set({ tasks })} t=${t} lang=${lang} />

    <div class="actions sticky">
      <button class="btn danger ghost" onClick=${remove}>${t('common.delete')}</button>
      <span class="grow"></span>
      ${dirty && html`<span class="muted">${t('common.unsaved')}</span>`}
      <button class="btn ghost" disabled=${!dirty} onClick=${() => { setBase(building); setD(building); }}>${t('common.reset')}</button>
      <button class="btn" disabled=${!dirty || busy} onClick=${save}>${busy ? t('common.wait') : t('common.save')}</button>
    </div>
    ${qrModal && html`<${QrManager} ctx=${ctx} b=${building} onClose=${() => setQrModal(false)} print=${print} />`}
  </section>`;
}

function QrManager({ ctx, b, onClose, print }) {
  const { t, data, cloud, run, handleCas } = ctx;
  const [busy, setBusy] = useState(false);
  const newCode = async () => {
    if (!confirm(t('qr.newConfirm'))) return;
    const code = nextUniqueQrCode(data.buildings, data.retired);
    setBusy(true);
    const res = await run(() => cloud.saveBuilding(applyBuildingEdit(b, { ...b, qrCode: code }), b.updatedAtMs, b._sort ?? 0));
    setBusy(false);
    if (res && handleCas(res, t('qr.newDone'))) onClose();
  };
  const retire = async (code) => {
    if (!confirm(t('qr.retireConfirm', code))) return;
    const primary = normalizeQr(code) === normalizeQr(b.qrCode);
    const replacement = primary ? nextUniqueQrCode(data.buildings, data.retired) : '';
    if (replacement && isRetired(replacement, data.retired)) return;
    setBusy(true);
    const res = await run(() => cloud.retireQr(b.id, code, replacement, b.updatedAtMs));
    setBusy(false);
    if (res && handleCas(res, t('qr.retired'))) onClose();
  };
  return html`<${Modal} title=${t('b.qr')} onClose=${onClose}>
    <div class="qr-box"><${QrCode} text=${b.qrCode} size=${200} /><code>${b.qrCode}</code></div>
    <p class="hint">${t('qr.hint')}</p>
    ${(b.qrAliases || []).length > 0 && html`<h3>${t('qr.aliases')}</h3><ul class="plain">${b.qrAliases.map((a) => html`<li><code>${a}</code>
      <button class="link danger" disabled=${busy} onClick=${() => retire(a)}>${t('qr.retire')}</button></li>`)}</ul>`}
    <div class="actions">
      <button class="btn ghost danger" disabled=${busy} onClick=${() => retire(b.qrCode)}>${t('qr.retirePrimary')}</button>
      <button class="btn ghost" disabled=${busy} onClick=${newCode}>${t('qr.new')}</button>
      <button class="btn" onClick=${() => print(html`<${Poster} b=${b} company=${data.company} />`)}>${t('b.printPoster')}</button>
    </div>
  <//>`;
}

/** A4 poster like QrHelper.generateQrPosterPdf. */
export function Poster({ b, company }) {
  return html`<div class="poster">
    <div class="poster-head"><div><div class="poster-co">${company.companyName || ''}</div>
      <div class="poster-sub">OBJEKT CHECK-IN • QR-CODE AUSHANG<br />Bitte vor Reinigungsbeginn mit der SCleaning App scannen</div></div>
      ${company.logoBase64 && html`<img class="poster-logo" src=${logoSrc(company.logoBase64)} alt="" />`}</div>
    <div class="poster-info"><b>${b.name}</b><br />${b.address}<br />Auftraggeber: ${b.clientName} • Vertrag: ${b.contractNumber || '—'}</div>
    <div class="poster-qr"><${QrCode} text=${b.qrCode} size=${330} /><code>${b.qrCode}</code></div>
    <div class="poster-foot">DE: Bitte vor Beginn scannen · EN: Scan before you start · SQ: Skanoni para fillimit · PL: Zeskanuj przed rozpoczęciem ·
      RO: Scanați înainte de început · TR: Başlamadan önce tarayın · UK: Скануйте перед початком · ES: Escanee antes de empezar ·
      RU: Сканируйте перед началом · AR: امسح قبل البدء</div>
  </div>`;
}
