import { useState, useEffect } from '../../vendor/preact-htm.module.js?v=30db8cbe75';
import { html, Field, Input, TextArea, Select, Toggle, imageFileToBase64, logoSrc } from '../ui.js?v=30db8cbe75';
import { publicCompany, hashManagerPassword, MIN_MANAGER_PASSWORD_LENGTH } from '../model.js?v=30db8cbe75';

/** Saves the whole company profile (templates included) against the revision it was loaded with. */
export async function saveCompanyProfile(ctx, profile, okText, ownerPinHash = '', expected = ctx.data.company.updatedAtMs || 0) {
  const { cloud, run, handleCas } = ctx;
  const res = await run(() => cloud.saveCompany(publicCompany(profile), expected, ownerPinHash));
  return !!res && handleCas(res, okText);
}

export function Company({ ctx }) {
  const { data, t, cloud } = ctx;
  const [base, setBase] = useState(data.company);
  const [d, setD] = useState(data.company);
  const [busy, setBusy] = useState(false);
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const set = (patch) => setD((cur) => ({ ...cur, ...patch }));
  const dirty = JSON.stringify(d) !== JSON.stringify(base);
  const link = `${location.origin}${location.pathname}#u=${encodeURIComponent(cloud.url)}&k=${encodeURIComponent(cloud.key)}`;
  useEffect(() => {
    if (data.company.updatedAtMs !== base.updatedAtMs && !dirty) { setBase(data.company); setD(data.company); }
  }, [data.company.updatedAtMs]);

  const save = async () => {
    setBusy(true);
    if (await saveCompanyProfile(ctx, d, t('saved'), '', base.updatedAtMs || 0)) setBase(d);
    setBusy(false);
  };
  const savePassword = async () => {
    if (pw.trim().length < MIN_MANAGER_PASSWORD_LENGTH) return ctx.notify(t('co.pwShort', MIN_MANAGER_PASSWORD_LENGTH), 'err');
    if (pw !== pw2) return ctx.notify(t('co.pwMismatch'), 'err');
    setBusy(true);
    if (await saveCompanyProfile(ctx, data.company, t('co.pwSaved'), await hashManagerPassword(pw))) { setPw(''); setPw2(''); }
    setBusy(false);
  };
  const pickLogo = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try { set({ logoBase64: await imageFileToBase64(file) }); } catch { ctx.notify(t('co.logoError'), 'err'); }
  };

  return html`<div>
    <div class="top"><h1>${t('nav.company')}</h1></div>
    <section class="card">
      <h2>${t('co.profile')}</h2>
      <div class="form two">
        <${Field} label=${t('co.name')} hint=${t('co.nameHint')}><${Input} value=${d.companyName} onInput=${() => {}} readOnly /><//>
        <${Field} label=${t('co.owner')}><${Input} value=${d.ownerName} onInput=${(v) => set({ ownerName: v })} /><//>
        <${Field} label=${t('co.street')}><${Input} value=${d.streetAddress} onInput=${(v) => set({ streetAddress: v })} /><//>
        <${Field} label=${t('co.city')}><${Input} value=${d.postalCity} onInput=${(v) => set({ postalCity: v })} /><//>
        <${Field} label=${t('co.phone')}><${Input} value=${d.phone} onInput=${(v) => set({ phone: v })} /><//>
        <${Field} label=${t('co.email')}><${Input} type="email" value=${d.email} onInput=${(v) => set({ email: v })} /><//>
        <${Field} label=${t('co.tax')}><${Input} value=${d.taxId} onInput=${(v) => set({ taxId: v })} /><//>
        <${Field} label=${t('co.pdfLang')}><${Select} value=${(d.customerPdfLangCode || 'de').toLowerCase() === 'en' ? 'en' : 'de'} onChange=${(v) => set({ customerPdfLangCode: v })} options=${[['de', 'Deutsch'], ['en', 'English']]} /><//>
        <${Field} label=${t('co.footer')} wide><${TextArea} rows="2" value=${d.invoiceFooterText} onInput=${(v) => set({ invoiceFooterText: v })} /><//>
        <${Field} label=${t('co.logo')}>
          <div class="row">${d.logoBase64 && html`<img class="logo-preview" src=${logoSrc(d.logoBase64)} alt="" />`}
            <input type="file" accept="image/png,image/jpeg" onChange=${pickLogo} />
            ${d.logoBase64 && html`<button class="link danger" onClick=${() => set({ logoBase64: '' })}>${t('common.delete')}</button>`}</div><//>
        <div class="field">
          <${Toggle} checked=${d.ecoPhotoMode} onChange=${(v) => set({ ecoPhotoMode: v })} label=${t('co.eco')} />
          <${Toggle} checked=${d.restrictClientPdfShareToManagers} onChange=${(v) => set({ restrictClientPdfShareToManagers: v })} label=${t('co.restrictPdf')} />
        </div>
      </div>
      <div class="actions"><span class="grow"></span>${dirty && html`<span class="muted">${t('common.unsaved')}</span>`}
        <button class="btn ghost" disabled=${!dirty} onClick=${() => { setBase(data.company); setD(data.company); }}>${t('common.reset')}</button>
        <button class="btn" disabled=${!dirty || busy} onClick=${save}>${t('common.save')}</button></div>
    </section>

    <section class="card">
      <h2>${t('co.password')}</h2>
      <p class="hint">${t('co.passwordHint')}</p>
      <div class="form two">
        <${Field} label=${t('co.newPw')}><${Input} type="password" autocomplete="new-password" value=${pw} onInput=${setPw} /><//>
        <${Field} label=${t('co.repeatPw')}><${Input} type="password" autocomplete="new-password" value=${pw2} onInput=${setPw2} /><//>
      </div>
      <div class="actions"><span class="grow"></span><button class="btn" disabled=${busy || !pw} onClick=${savePassword}>${t('co.setPw')}</button></div>
    </section>

    <section class="card">
      <h2>${t('co.web')}</h2>
      <p class="hint">${t('co.webHint')}</p>
      <div class="row"><input class="in grow" readOnly value=${link} onFocus=${(e) => e.target.select()} />
        <button class="btn ghost" onClick=${() => navigator.clipboard?.writeText(link).then(() => ctx.notify(t('co.copied')))}>${t('co.copy')}</button></div>
      <p class="muted small">${t('co.phoneOnly')}</p>
    </section>
  </div>`;
}
