// Task library, building templates and quick-issue labels exported from the app (WebContractTest keeps it in sync).
import { useEffect, useState } from '../vendor/preact-htm.module.js?v=e23e5b5c61';

let cache = null;
let pending = null;

export function useAppData() {
  const [data, setData] = useState(cache);
  useEffect(() => {
    if (cache) return;
    pending ||= fetch('data/app-data.json?v=e23e5b5c61').then((r) => r.json()).then((d) => (cache = d));
    pending.then(setData).catch(() => setData({ taskLibrary: [], buildingTemplates: [], quickIssues: [] }));
  }, []);
  return data || { taskLibrary: [], buildingTemplates: [], quickIssues: [] };
}
