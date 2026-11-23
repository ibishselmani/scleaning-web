// "Datensicherung": downloads everything in the company's cloud in the app's backup format.
import { useState } from '../../vendor/preact-htm.module.js?v=e23e5b5c61';
import { html, Toggle } from '../ui.js?v=e23e5b5c61';
import { buildBundle, planMedia, applyMedia, crc32, zipParts, appLimits } from '../backup.js?v=e23e5b5c61';

function saveBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}
const mb = (n, lang) => (n / 1048576).toLocaleString(lang, { maximumFractionDigits: 1 });

export function BackupCard({ ctx }) {
  const { cloud, t, run, lang } = ctx;
  const [withMedia, setWithMedia] = useState(false);
  const [progress, setProgress] = useState('');
  const [result, setResult] = useState(null);

  const download = async () => {
    setResult(null);
    setProgress(t('bk.loading'));
    await run(async () => {
      const [company, buildings, workers, issues, retired, reports, billing] = await Promise.all([
        cloud.loadCompany(), cloud.loadBuildings(), cloud.loadWorkers(), cloud.loadIssues(), cloud.loadRetired(), cloud.loadAllReports(),
        cloud.loadBilling().then((b) => b.book).catch(() => null),
      ]);
      const args = { company: company || {}, buildings, workers, issues, retired, billing, companyId: cloud.companyId };
      const date = new Date().toISOString().slice(0, 10);
      const enc = new TextEncoder();
      if (!withMedia) {
        const bytes = enc.encode(JSON.stringify(buildBundle({ ...args, reports })));
        saveBlob(new Blob([bytes], { type: 'application/json' }), `SCleaning-Sicherung-${date}.json`);
        setResult({ reports: reports.length, size: bytes.length, missing: 0, limits: appLimits({ jsonBytes: bytes.length, zipBytes: 0, entries: 1 }) });
        return;
      }
      const plan = planMedia(reports);
      const entries = [];
      const done = new Set();
      let missing = 0;
      for (let i = 0; i < plan.length; i += 100) {
        const chunk = plan.slice(i, i + 100);
        const urls = await cloud.signedUrls(chunk.map((m) => m.remotePath)).catch(() => ({}));
        let next = 0;
        const worker = async () => {
          while (next < chunk.length) {
            const m = chunk[next++];
            try {
              if (!urls[m.remotePath]) throw new Error('no url');
              const res = await fetch(urls[m.remotePath]);
              if (!res.ok) throw new Error(`HTTP ${res.status}`);
              const bytes = new Uint8Array(await res.arrayBuffer());
              entries.push({ name: m.entryName, data: new Blob([bytes]), size: bytes.length, crc: crc32(bytes) });
              done.add(m.entryName);
            } catch {
              missing++;
            }
            setProgress(t('bk.media', done.size + missing, plan.length));
          }
        };
        await Promise.all([worker(), worker(), worker(), worker()]);
      }
      const json = enc.encode(JSON.stringify(buildBundle({ ...args, reports: applyMedia(reports, plan, done) })));
      const all = [{ name: 'backup.json', data: json, size: json.length, crc: crc32(json) }, ...entries];
      const zipBytes = all.reduce((s, e) => s + 76 + e.name.length + e.size, 22);
      if (zipBytes > 3.9 * 1024 ** 3) throw new Error(t('bk.huge'));
      saveBlob(new Blob(zipParts(all), { type: 'application/zip' }), `SCleaning-Sicherung-${date}.zip`);
      setResult({ reports: reports.length, size: zipBytes, missing, limits: appLimits({ jsonBytes: json.length, zipBytes, entries: all.length }) });
    });
    setProgress('');
  };

  return html`<section class="card">
    <h2>${t('bk.title')}</h2>
    <p class="hint">${t('bk.hint')}</p>
    <${Toggle} checked=${withMedia} onChange=${setWithMedia} label=${t('bk.withMedia')} />
    <div class="actions"><button class="btn" disabled=${!!progress} onClick=${download}>${progress || t('bk.download')}</button></div>
    ${result && html`<p class="small">${t('bk.done', result.reports, mb(result.size, lang))}${result.missing ? ` ${t('bk.missing', result.missing)}` : ''}</p>`}
    ${result?.limits.length ? html`<div class="notice">${t('bk.tooBig')}</div>` : null}
    <p class="muted small">${t('bk.restore')}</p>
  </section>`;
}
