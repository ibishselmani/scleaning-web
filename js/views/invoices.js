// Invoices: read the app's billing book, download the frozen originals, mark sent / paid.
// Issuing and cancelling stay in the app (they create legal documents with validated XRechnung).
import { useState, useEffect, useCallback } from '../../vendor/preact-htm.module.js?v=e23e5b5c61';
import { html, Pill, downloadText } from '../ui.js?v=e23e5b5c61';
import { csvEscape } from '../model.js?v=e23e5b5c61';
import { monthRows, monthTotals, invoiceStage, formatCents, setInvoicePaid, setInvoiceSent, documentsOf, base64ToBytes } from '../billing.js?v=e23e5b5c61';

const KIND = { DRAFT: '', ISSUED: 'warn', CONFIRMED_SENT: 'info', PAID: 'ok', CANCELLED: 'bad' };

function previousMonth() {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
const today = () => new Date().toISOString().slice(0, 10);
const eur = (c) => `${formatCents(c)} €`;
const isSent = (inv) => !!inv.sentConfirmed && inv.sentAtMs > 0;

function saveDoc(doc) {
  const blob = new Blob([doc.base64 ? base64ToBytes(doc.base64) : doc.text], { type: doc.type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = doc.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function Invoices({ ctx }) {
  const { cloud, data, t, lang, notify, run } = ctx;
  const [month, setMonth] = useState(previousMonth());
  const [billing, setBilling] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    try {
      setBilling(await cloud.loadBilling());
      setError('');
    } catch (e) {
      setError(e.message === 'network' ? t('err.network') : e.status === 403 ? t('inv.noAccess') : e.message);
    }
  }, [cloud, t]);
  useEffect(() => { load(); }, [load]);

  if (error) return html`<div><div class="top"><h1>${t('nav.invoices')}</h1></div><div class="error">${t('err.load', error)}</div></div>`;
  if (!billing) return html`<div class="loading">${t('common.loading')}</div>`;

  const book = billing.book;
  const rows = book ? monthRows(book, data.buildings, month) : [];
  const totals = monthTotals(rows);
  const canWrite = !!book && billing.safeToWrite;

  /** Re-reads the cloud copy right before writing, so a change made on the phone meanwhile is never overwritten. */
  const toggle = async (inv, kind) => {
    setBusy(`${inv.number}-${kind}`);
    await run(async () => {
      const fresh = await cloud.loadBilling();
      setBilling(fresh);
      const cur = fresh.book?.invoices?.find((i) => i.number === inv.number);
      if (!fresh.book || !fresh.safeToWrite) return notify(t('inv.notSynced'), 'err');
      if (!cur || cur.cancellation) return notify(t('inv.changed'), 'err');
      const next = kind === 'paid'
        ? setInvoicePaid(fresh.book, inv.number, !(inv.paidAtMs > 0))
        : setInvoiceSent(fresh.book, inv.number, !isSent(inv));
      const res = await cloud.saveBilling(next, fresh.row);
      notify(res === 'ok' ? t('inv.saved') : t('inv.conflict'), res === 'ok' ? 'ok' : 'err');
      await load();
    });
    setBusy('');
  };

  const exportCsv = () => {
    const head = [t('inv.number'), t('b.name'), t('b.client'), t('inv.month'), t('inv.date'), t('inv.due'), t('inv.net'), t('inv.vat'), t('inv.gross'), t('w.status'), t('inv.paidOn')];
    const lines = rows.flatMap((r) => r.history).map((i) => {
      const r = rows.find((x) => x.buildingId === i.buildingId);
      return [i.number, r?.name || i.buildingId, r?.clientName || '', i.month, i.issueDate, i.dueDate, formatCents(i.netCents), formatCents(i.vatCents),
        formatCents(i.grossCents), t(`inv.stage.${invoiceStage(i)}`) + (i.cancellation ? ` (${i.cancellation.number})` : ''),
        i.paidAtMs > 0 ? new Date(i.paidAtMs).toLocaleDateString('de-DE') : ''];
    });
    downloadText(`SCleaning-Rechnungen-${month}.csv`, [head, ...lines].map((l) => l.map(csvEscape).join(';')).join('\r\n'));
  };

  return html`<div>
    <div class="top"><h1>${t('nav.invoices')}</h1>
      <input class="in" type="month" value=${month} onInput=${(e) => e.target.value && setMonth(e.target.value)} aria-label=${t('inv.month')} />
      <button class="btn ghost" onClick=${load}>${t('common.refresh')}</button>
      <button class="btn ghost" onClick=${exportCsv} disabled=${!rows.length}>CSV</button></div>
    <p class="muted small">${t('inv.intro')}</p>
    ${!book && html`<div class="notice">${t('inv.empty')}</div>`}
    ${book && !billing.safeToWrite && html`<div class="notice">${t('inv.notSynced')}</div>`}
    ${book && html`<div class="kpis small">
      <div class="kpi"><b>${totals.count}</b><small>${t('inv.count')}</small></div>
      <div class="kpi"><b>${eur(totals.grossCents)}</b><small>${t('inv.total')}</small></div>
      <div class="kpi"><b>${eur(totals.openCents)}</b><small>${t('inv.open')}</small></div>
      <div class="kpi"><b>${eur(totals.paidCents)}</b><small>${t('inv.paid')}</small></div>
    </div>`}
    ${book && html`<section class="card">
      ${rows.length === 0 ? html`<p class="muted">${t('inv.none')}</p>` : html`<table>
        <thead><tr><th>${t('b.name')}</th><th>${t('inv.number')}</th><th>${t('inv.date')}</th><th class="num">${t('inv.gross')}</th><th>${t('w.status')}</th><th></th></tr></thead>
        <tbody>${rows.map((r) => html`<${InvoiceRow} key=${r.buildingId} r=${r} t=${t} lang=${lang} canWrite=${canWrite} busy=${busy} onToggle=${toggle} />`)}</tbody>
      </table>`}
    </section>`}
  </div>`;
}

function InvoiceRow({ r, t, lang, canWrite, busy, onToggle }) {
  const inv = r.invoice;
  const name = html`<td><b>${r.name}</b>${r.clientName ? html`<br /><small class="muted">${r.clientName}</small>` : null}
    ${!r.exists ? html`<br /><small class="muted">${t('inv.buildingGone')}</small>` : null}</td>`;
  if (!inv) {
    return html`<tr>${name}<td colspan="2" class="muted">${t('inv.notIssued')}</td>
      <td class="num muted">${r.priceCents ? `${eur(r.priceCents)} ${t('inv.netShort')}` : ''}</td><td><${Pill}>${t('inv.stage.DRAFT')}<//></td><td></td></tr>`;
  }
  const stage = invoiceStage(inv);
  const overdue = (stage === 'ISSUED' || stage === 'CONFIRMED_SENT') && inv.dueDate && inv.dueDate < today();
  const older = r.history.filter((h) => h.number !== inv.number);
  const docs = (i) => documentsOf(i).map((d) => html`<button class="link" onClick=${() => saveDoc(d)} title=${d.name}>${d.name.endsWith('.pdf') ? (d.name.startsWith('Storno') ? t('inv.stornoPdf') : 'PDF') : (d.name.startsWith('Storno') ? t('inv.stornoXml') : 'XML')}</button>`);
  return html`
    <tr>${name}
      <td><b>${inv.number}</b>${inv.replacesInvoiceNumber ? html`<br /><small class="muted">${t('inv.replaces', inv.replacesInvoiceNumber)}</small>` : null}</td>
      <td>${new Date(inv.issueDate).toLocaleDateString(lang)}<br /><small class="muted">${t('inv.dueOn', new Date(inv.dueDate).toLocaleDateString(lang))}</small></td>
      <td class="num"><b>${eur(inv.grossCents)}</b><br /><small class="muted">${eur(inv.netCents)} ${t('inv.netShort')}</small></td>
      <td><${Pill} kind=${KIND[stage]}>${t(`inv.stage.${stage}`)}<//>${overdue ? html` <${Pill} kind="bad">${t('inv.overdue')}<//>` : null}
        ${inv.paidAtMs > 0 ? html`<br /><small class="muted">${new Date(inv.paidAtMs).toLocaleDateString(lang)}</small>` : null}</td>
      <td class="row-actions">${docs(inv)}
        ${stage !== 'CANCELLED' && canWrite && html`
          <button class="btn ghost small" disabled=${!!busy} onClick=${() => onToggle(inv, 'sent')}>${busy === `${inv.number}-sent` ? '…' : isSent(inv) ? t('inv.markUnsent') : t('inv.markSent')}</button>
          <button class="btn small" disabled=${!!busy} onClick=${() => onToggle(inv, 'paid')}>${busy === `${inv.number}-paid` ? '…' : inv.paidAtMs > 0 ? t('inv.markUnpaid') : t('inv.markPaid')}</button>`}
      </td></tr>
    ${older.map((h) => html`<tr class="sub"><td></td>
      <td><s>${h.number}</s>${h.cancellation ? html`<br /><small class="muted">${t('inv.cancelledBy', h.cancellation.number, h.cancellation.reason)}</small>` : null}</td>
      <td>${new Date(h.issueDate).toLocaleDateString(lang)}</td><td class="num muted">${eur(h.grossCents)}</td>
      <td><${Pill} kind=${KIND[invoiceStage(h)]}>${t(`inv.stage.${invoiceStage(h)}`)}<//></td><td class="row-actions">${docs(h)}</td></tr>`)}`;
}
