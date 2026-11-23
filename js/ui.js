// Small shared UI pieces. htm escapes every interpolated value, so user text can never inject HTML.
import { html, useState, useEffect, useRef } from '../vendor/preact-htm.module.js?v=30db8cbe75';

export { html };

export function Field({ label, hint, children, wide }) {
  return html`<label class=${`field${wide ? ' wide' : ''}`}><span class="lbl">${label}</span>${children}${hint ? html`<small class="hint">${hint}</small>` : null}</label>`;
}

export function Input({ value, onInput, type = 'text', ...rest }) {
  return html`<input class="in" type=${type} value=${value ?? ''} onInput=${(e) => onInput(type === 'number' ? Number(e.target.value) : e.target.value)} ...${rest} />`;
}

export function TextArea({ value, onInput, rows = 3, ...rest }) {
  return html`<textarea class="in" rows=${rows} onInput=${(e) => onInput(e.target.value)} ...${rest}>${value ?? ''}</textarea>`;
}

export function Select({ value, onChange, options, ...rest }) {
  return html`<select class="in" value=${value} onChange=${(e) => onChange(e.target.value)} ...${rest}>
    ${options.map(([v, l]) => html`<option value=${v} selected=${String(v) === String(value)}>${l}</option>`)}
  </select>`;
}

export function Toggle({ checked, onChange, label }) {
  return html`<label class="toggle"><input type="checkbox" checked=${!!checked} onChange=${(e) => onChange(e.target.checked)} /><span class="sw"></span>${label}</label>`;
}

export function Pill({ kind, children }) {
  return html`<span class=${`pill ${kind || ''}`}>${children}</span>`;
}

export function Modal({ title, onClose, children, wide }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return html`<div class="overlay" onClick=${(e) => e.target === e.currentTarget && onClose()}>
    <div class=${`modal${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label=${title}>
      <div class="modal-head"><h2>${title}</h2><button class="icon" aria-label="Close" onClick=${onClose}>✕</button></div>
      <div class="modal-body">${children}</div>
    </div>
  </div>`;
}

/** Renders `text` as an SVG QR code (qrcode-generator, loaded as a global script). */
export function QrCode({ text, size = 240 }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!ref.current || !window.qrcode) return;
    const qr = window.qrcode(0, 'M');
    qr.addData(text, 'Byte');
    qr.make();
    ref.current.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  }, [text]);
  return html`<div class="qr" style=${`width:${size}px;height:${size}px`} ref=${ref}></div>`;
}

/** Prints `node` alone (Save as PDF in the browser's print dialog). */
export function usePrint() {
  const [content, setContent] = useState(null);
  useEffect(() => {
    if (!content) return;
    const done = () => setContent(null);
    window.addEventListener('afterprint', done, { once: true });
    const id = setTimeout(() => window.print(), 300);
    return () => clearTimeout(id);
  }, [content]);
  const view = content ? html`<div id="print-root">${content}</div>` : null;
  return [view, setContent];
}

export function downloadText(filename, text, type = 'text/csv;charset=utf-8') {
  const blob = new Blob(['﻿', text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Shrinks an image file to at most `max` px and returns base64 without the data: prefix (like the app). */
export function imageFileToBase64(file, max = 512) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      const png = file.type === 'image/png';
      resolve(c.toDataURL(png ? 'image/png' : 'image/jpeg', 0.86).split(',')[1]);
      URL.revokeObjectURL(img.src);
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

export const logoSrc = (b64) => (b64 ? `data:image/${b64.startsWith('iVBOR') ? 'png' : 'jpeg'};base64,${b64}` : '');
