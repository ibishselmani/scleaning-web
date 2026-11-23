// Invoice logic of the web manager. The app owns invoicing: it issues and cancels invoices and freezes their
// original PDF/XML. The web only reads the billing book and toggles "sent" and "paid", exactly like the app's
// BillingStore.markInvoiceSent / setInvoicePaid. Pure functions; tested against a book written by the app.

const seq = (number) => {
  const n = parseInt(String(number).split('-').pop(), 10);
  return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER;
};

export function invoiceStage(inv) {
  if (!inv) return 'DRAFT';
  if (inv.cancellation) return 'CANCELLED';
  if ((inv.paidAtMs || 0) > 0) return 'PAID';
  if (inv.sentConfirmed && (inv.sentAtMs || 0) > 0) return 'CONFIRMED_SENT';
  return 'ISSUED';
}

/** The active invoice of a building and month, else the newest cancelled one (as in the app). */
export function latestInvoice(book, buildingId, month) {
  const history = (book?.invoices || []).filter((i) => i.buildingId === buildingId && i.month === month);
  const active = history.filter((i) => !i.cancellation);
  if (active.length === 1) return active[0];
  return history.sort((a, b) => seq(b.number) - seq(a.number))[0] || null;
}

/** 123456 -> "1.234,56" */
export function formatCents(cents) {
  const neg = cents < 0;
  const abs = Math.abs(Math.trunc(cents));
  const euros = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${neg ? '-' : ''}${euros},${String(abs % 100).padStart(2, '0')}`;
}

function change(book, number, nowMs, edit) {
  const out = structuredClone(book);
  const inv = (out.invoices || []).find((i) => i.number === number);
  if (!inv) throw new Error('not_found');
  if (inv.cancellation) throw new Error('cancelled');
  const now = Math.max(nowMs, (book.updatedAtMs || 0) + 1);
  edit(inv, now);
  out.updatedAtMs = now;
  return out;
}

export const setInvoicePaid = (book, number, paid, nowMs = Date.now()) =>
  change(book, number, nowMs, (inv, now) => { inv.paidAtMs = paid ? now : 0; });

export const setInvoiceSent = (book, number, sent, nowMs = Date.now()) =>
  change(book, number, nowMs, (inv, now) => { inv.sentAtMs = sent ? now : 0; inv.sentConfirmed = !!sent; });

/**
 * The app keeps two cloud copies: the `sc_billing` row and a JSON file in storage. Like the app's pull, the newer
 * one wins. Writing is only safe when the newer copy contains every invoice of the older one; otherwise the phone
 * has to sync first (its merge never drops invoices, ours would).
 */
export function pickCloudBook(row, storageBook) {
  const tableBook = row?.payload && typeof row.payload === 'object' && Array.isArray(row.payload.invoices)
    ? { ...row.payload, updatedAtMs: Math.max(row.payload.updatedAtMs || 0, row.updated_at || 0) }
    : null;
  const store = storageBook && Array.isArray(storageBook.invoices) ? storageBook : null;
  if (!tableBook || !store) return { book: tableBook || store, safeToWrite: true };
  const [newer, older] = (store.updatedAtMs || 0) > tableBook.updatedAtMs ? [store, tableBook] : [tableBook, store];
  const have = new Set(newer.invoices.map((i) => i.number));
  return { book: newer, safeToWrite: older.invoices.every((i) => have.has(i.number)) };
}

/** One row per building that has a price or an invoice in `month`. */
export function monthRows(book, buildings, month) {
  const byId = new Map(buildings.map((b) => [b.id, b]));
  const ids = new Set();
  for (const [id, bb] of Object.entries(book?.buildings || {})) if ((bb?.monthlyNetCents || 0) > 0) ids.add(id);
  for (const inv of book?.invoices || []) if (inv.month === month) ids.add(inv.buildingId);
  return [...ids].map((id) => {
    const b = byId.get(id);
    const invoice = latestInvoice(book, id, month);
    const history = (book.invoices || []).filter((i) => i.buildingId === id && i.month === month).sort((x, y) => seq(x.number) - seq(y.number));
    return {
      buildingId: id, name: b?.name || id, clientName: b?.clientName || '', exists: !!b,
      priceCents: book.buildings?.[id]?.monthlyNetCents || 0, invoice, stage: invoiceStage(invoice), history,
    };
  }).sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

export function monthTotals(rows) {
  const active = rows.map((r) => r.invoice).filter((i) => i && !i.cancellation);
  const sum = (list) => list.reduce((s, i) => s + (i.grossCents || 0), 0);
  return {
    count: active.length,
    grossCents: sum(active),
    openCents: sum(active.filter((i) => !(i.paidAtMs > 0))),
    paidCents: sum(active.filter((i) => i.paidAtMs > 0)),
  };
}

/** Original documents with the file names the app uses. */
export function documentsOf(inv) {
  const docs = [];
  if (inv.originalPdfBase64) docs.push({ name: `Rechnung_${inv.number}.pdf`, type: 'application/pdf', base64: inv.originalPdfBase64 });
  if (inv.originalXml) docs.push({ name: `Rechnung_${inv.number}_xrechnung.xml`, type: 'application/xml', text: inv.originalXml });
  const c = inv.cancellation;
  if (c?.originalPdfBase64) docs.push({ name: `Storno_${c.number}.pdf`, type: 'application/pdf', base64: c.originalPdfBase64 });
  if (c?.originalXml) docs.push({ name: `Storno_${c.number}_xrechnung.xml`, type: 'application/xml', text: c.originalXml });
  return docs;
}

export function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
