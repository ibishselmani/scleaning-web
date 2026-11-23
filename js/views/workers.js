import { useState } from '../../vendor/preact-htm.module.js?v=e23e5b5c61';
import { html, Field, Input, Select, Toggle, Modal, QrCode, Pill } from '../ui.js?v=e23e5b5c61';
import { newWorker, suggestWorkerCode, hashWorkerPin, newInviteToken, encodeSetupInvite, WORKER_LANGS } from '../model.js?v=e23e5b5c61';

const LANG_NAMES = { de: 'Deutsch', en: 'English', pl: 'Polski', ro: 'Română', sq: 'Shqip', tr: 'Türkçe', uk: 'Українська', es: 'Español', ru: 'Русский', ar: 'العربية' };

export function Workers({ ctx }) {
  const { data, t, cloud, run, handleCas } = ctx;
  const [editing, setEditing] = useState(null);
  const [invite, setInvite] = useState(null);
  const [showInactive, setShowInactive] = useState(false);
  const list = data.workers.filter((w) => showInactive || w.active);

  const makeInvite = async (w, type, replaceExisting = false) => {
    if (replaceExisting && !confirm(t('w.replaceConfirm', w.name))) return;
    const token = await newInviteToken();
    const res = await run(() => cloud.createInvite({ workerId: w?.id || '', workerCode: w?.workerCode || '', tokenHash: token.hash, type, replaceExisting }));
    if (!res) return;
    const row = Array.isArray(res) ? res[0] : res;
    setInvite({
      worker: w, type, expiresAt: row?.expires_at,
      text: encodeSetupInvite({ url: cloud.url, key: cloud.key, workerCode: type === 'shared_station' ? '' : w.workerCode, companyId: cloud.companyId, token: token.raw, type }),
    });
  };
  const unlink = async (w) => {
    if (!confirm(t('w.unlinkConfirm', w.name))) return;
    const ok = await run(async () => { await cloud.revokeDevice(w.id); return true; });
    if (ok) { ctx.notify(t('w.unlinked')); ctx.reload(); }
  };
  const setActive = async (w, active) => {
    const res = await run(() => cloud.saveWorker({ ...w, active }, w.updatedAtMs));
    if (res) handleCas(res, t('saved'));
  };
  const remove = async (w) => {
    if (!confirm(t('w.deleteConfirm', w.name))) return;
    const res = await run(() => cloud.deleteEntity('WORKER', w.id, w.updatedAtMs));
    if (res) handleCas(res, t('deleted'));
  };

  return html`<div>
    <div class="top"><h1>${t('nav.workers')}</h1>
      <${Toggle} checked=${showInactive} onChange=${setShowInactive} label=${t('w.showInactive')} />
      <button class="btn ghost" onClick=${() => makeInvite(null, 'shared_station')}>${t('w.stationQr')}</button>
      <button class="btn" onClick=${() => setEditing({})}>+ ${t('w.new')}</button></div>
    <section class="card">
      ${list.length === 0 ? html`<p class="muted">${t('w.none')}</p>` : html`<table>
        <thead><tr><th>${t('w.code')}</th><th>${t('w.name')}</th><th>${t('w.lang')}</th><th>${t('w.phone')}</th><th>${t('w.device')}</th><th>${t('w.status')}</th><th></th></tr></thead>
        <tbody>${list.map((w) => html`<tr>
          <td><b>${w.workerCode}</b></td><td>${w.name}</td><td>${LANG_NAMES[w.preferredLangCode] || w.preferredLangCode}</td><td>${w.phone}</td>
          <td>${w.authUserId ? html`<${Pill} kind="ok">${t('w.linked')}<//>` : html`<${Pill}>${t('w.notLinked')}<//>`}
            ${w.hasPin ? html` <${Pill} kind="info">PIN<//>` : null}</td>
          <td>${w.active ? html`<${Pill} kind="ok">${t('w.active')}<//>` : html`<${Pill} kind="warn">${t('w.inactive')}<//>`}</td>
          <td class="row-actions">
            <button class="link" onClick=${() => setEditing(w)}>${t('common.edit')}</button>
            ${w.active && (w.authUserId
              ? html`<button class="link" onClick=${() => makeInvite(w, 'personal', true)}>${t('w.replacePhone')}</button>
                 <button class="link" onClick=${() => unlink(w)}>${t('w.unlink')}</button>`
              : html`<button class="link" onClick=${() => makeInvite(w, 'personal')}>${t('w.connectPhone')}</button>`)}
            <button class="link" onClick=${() => setActive(w, !w.active)}>${w.active ? t('w.deactivate') : t('w.activate')}</button>
            <button class="link danger" onClick=${() => remove(w)}>${t('common.delete')}</button>
          </td></tr>`)}</tbody></table>`}
    </section>
    <p class="hint">${t('w.hint')}</p>
    ${editing && html`<${WorkerForm} ctx=${ctx} worker=${editing.id ? editing : null} onClose=${() => setEditing(null)} />`}
    ${invite && html`<${Modal} title=${invite.type === 'shared_station' ? t('w.stationQr') : t('w.inviteFor', invite.worker.name)} onClose=${() => setInvite(null)}>
      <div class="qr-box"><${QrCode} text=${invite.text} size=${300} /></div>
      <p>${invite.type === 'shared_station' ? t('w.stationSteps') : t('w.inviteSteps')}</p>
      <p class="muted small">${t('w.inviteExpiry', invite.expiresAt ? new Date(invite.expiresAt).toLocaleString(ctx.lang) : '7')}</p>
    <//>`}
  </div>`;
}

function WorkerForm({ ctx, worker, onClose }) {
  const { data, t, cloud, run, handleCas } = ctx;
  const [d, setD] = useState(worker || newWorker({ workerCode: suggestWorkerCode(data.workers), name: '' }));
  const [pin, setPin] = useState('');
  const [clearPin, setClearPin] = useState(false);
  const [busy, setBusy] = useState(false);
  const set = (patch) => setD((cur) => ({ ...cur, ...patch }));
  const save = async () => {
    if (!d.workerCode.trim() || !d.name.trim()) return ctx.notify(t('w.required'), 'err');
    const clash = data.workers.find((w) => w.id !== d.id && w.workerCode.trim().toLowerCase() === d.workerCode.trim().toLowerCase());
    if (clash) return ctx.notify(t('w.codeTaken', clash.name), 'err');
    if (pin && !/^\d{4,8}$/.test(pin)) return ctx.notify(t('w.pinFormat'), 'err');
    setBusy(true);
    const pinHash = pin ? await hashWorkerPin(pin) : '';
    const res = await run(() => cloud.saveWorker(d, worker ? worker.updatedAtMs : 0, { pinHash, clearPin: !pin && clearPin }));
    setBusy(false);
    if (res && handleCas(res, t('saved'))) onClose();
  };
  return html`<${Modal} title=${worker ? t('w.edit') : t('w.new')} onClose=${onClose}>
    <div class="form two">
      <${Field} label=${t('w.code')} hint=${t('w.codeHint')}><${Input} value=${d.workerCode} onInput=${(v) => set({ workerCode: v })} /><//>
      <${Field} label=${t('w.name')}><${Input} value=${d.name} onInput=${(v) => set({ name: v })} autofocus /><//>
      <${Field} label=${t('w.phone')}><${Input} value=${d.phone} onInput=${(v) => set({ phone: v })} /><//>
      <${Field} label=${t('w.lang')}><${Select} value=${d.preferredLangCode} onChange=${(v) => set({ preferredLangCode: v })} options=${WORKER_LANGS.map((l) => [l, LANG_NAMES[l]])} /><//>
      <${Field} label=${t('w.pin')} hint=${t('w.pinHint')}><${Input} type="password" inputmode="numeric" autocomplete="new-password" value=${pin} onInput=${setPin} placeholder=${worker?.hasPin ? '••••' : ''} /><//>
      <div class="field">
        ${worker?.hasPin && html`<${Toggle} checked=${clearPin} onChange=${setClearPin} label=${t('w.removePin')} />`}
        <${Toggle} checked=${d.active} onChange=${(v) => set({ active: v })} label=${t('w.active')} />
      </div>
    </div>
    <div class="actions"><button class="btn ghost" onClick=${onClose}>${t('common.cancel')}</button>
      <button class="btn" disabled=${busy} onClick=${save}>${busy ? t('common.wait') : t('common.save')}</button></div>
  <//>`;
}
