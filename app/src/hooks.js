import { useEffect, useRef, useState } from 'react';
import { localNotify } from './notify';

// Re-run `load` every `ms`; keeps the last good data if the network blips.
export function usePoll(load, deps, ms = 3000) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    let alive = true;
    const run = () => load().then(
      (d) => { if (alive) { setData(d); setError(null); } },
      (e) => { if (alive) setError(e.message); },
    );
    run();
    const t = setInterval(run, ms);
    return () => { alive = false; clearInterval(t); };
  }, deps);
  return [data, error];
}

// Notify for items that appear after the first load (the first load is history, not news).
export function useNotifyNew(items, toNotification) {
  const seen = useRef(null);
  useEffect(() => {
    if (!items) return;
    if (seen.current === null) {
      seen.current = new Set(items.map((i) => i.id));
      return;
    }
    for (const item of items) {
      if (seen.current.has(item.id)) continue;
      seen.current.add(item.id);
      const n = toNotification(item);
      if (n) localNotify(n.title, n.body);
    }
  }, [items]);
}
