// Checklist editor shared by buildings and templates.
import { useState } from '../../vendor/preact-htm.module.js';
import { html, Input, Select } from '../ui.js';
import { taskText, newTask } from '../model.js';
import { useAppData } from '../data.js';

export function TaskEditor({ tasks, onChange, t, lang }) {
  const appData = useAppData();
  const areas = [...new Set(appData.taskLibrary.map((x) => x.areaDe))];
  const [area, setArea] = useState('');
  const [customArea, setCustomArea] = useState('');
  const [customLabel, setCustomLabel] = useState('');

  const update = (i, patch) => onChange(tasks.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const move = (i, d) => {
    const next = [...tasks];
    const [x] = next.splice(i, 1);
    next.splice(Math.min(Math.max(i + d, 0), next.length), 0, x);
    onChange(next);
  };
  const addLibrary = (lib) => onChange([...tasks, { ...lib, id: `t-${Date.now()}-${tasks.length}` }]);
  const addCustom = () => {
    if (!customLabel.trim()) return;
    onChange([...tasks, newTask(customArea.trim() || t('task.general'), customLabel.trim(), true, Date.now(), tasks.length)]);
    setCustomLabel('');
  };
  const has = (lib) => tasks.some((x) => x.labelDe === lib.labelDe && x.areaDe === lib.areaDe);

  return html`<div class="tasks">
    ${tasks.length === 0 && html`<p class="muted">${t('task.empty')}</p>`}
    ${tasks.map((task, i) => html`<div class="task-row" key=${task.id}>
      <input class="in area" value=${task.areaDe} title=${taskText(task, lang, 'area')}
        onInput=${(e) => update(i, { areaDe: e.target.value, areaTranslations: {} })} aria-label=${t('task.area')} />
      <input class="in label" value=${task.labelDe} title=${taskText(task, lang, 'label')}
        onInput=${(e) => update(i, { labelDe: e.target.value, labelTranslations: {} })} aria-label=${t('task.label')} />
      <label class="req"><input type="checkbox" checked=${task.required !== false} onChange=${(e) => update(i, { required: e.target.checked })} />${t('task.required')}</label>
      <button class="icon" title=${t('common.up')} onClick=${() => move(i, -1)} disabled=${i === 0}>↑</button>
      <button class="icon" title=${t('common.down')} onClick=${() => move(i, 1)} disabled=${i === tasks.length - 1}>↓</button>
      <button class="icon danger" title=${t('common.delete')} onClick=${() => onChange(tasks.filter((_, j) => j !== i))}>✕</button>
    </div>`)}
    <div class="task-add">
      <div>
        <span class="lbl">${t('task.fromLibrary')}</span>
        <${Select} value=${area} onChange=${setArea} options=${[['', t('task.pickArea')], ...areas.map((a) => [a, taskText(appData.taskLibrary.find((x) => x.areaDe === a), lang, 'area')])]} />
        ${area && html`<div class="lib">${appData.taskLibrary.filter((x) => x.areaDe === area).map((lib) => html`
          <button class="chip" disabled=${has(lib)} onClick=${() => addLibrary(lib)}>+ ${taskText(lib, lang, 'label')}</button>`)}</div>`}
        <small class="hint">${t('task.libraryHint')}</small>
      </div>
      <div>
        <span class="lbl">${t('task.custom')}</span>
        <div class="row">
          <${Input} value=${customArea} onInput=${setCustomArea} placeholder=${t('task.area')} />
          <${Input} value=${customLabel} onInput=${setCustomLabel} placeholder=${t('task.label')} onKeyDown=${(e) => e.key === 'Enter' && (e.preventDefault(), addCustom())} />
          <button class="btn ghost" onClick=${addCustom}>${t('common.add')}</button>
        </div>
        <small class="hint">${t('task.customHint')}</small>
      </div>
    </div>
  </div>`;
}
