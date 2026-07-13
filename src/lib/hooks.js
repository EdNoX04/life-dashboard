import { useCallback, useEffect, useRef, useState } from 'react';
import * as db from './db.js';

// Live-ish collection: loads, exposes CRUD, refetches on an interval in
// remote mode (poll), and offers manual refresh everywhere.
export function useCollection(table, opts = {}) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const refresh = useCallback(async () => {
    try {
      setError(null);
      const rows = await db.list(table, optsRef.current);
      setItems(rows);
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setLoading(false);
    }
  }, [table]);

  useEffect(() => {
    refresh();
    if (db.isRemote()) {
      const t = setInterval(refresh, 45000); // poll: keeps data live without websockets
      return () => clearInterval(t);
    }
  }, [refresh]);

  const add = useCallback(async row => { const saved = await db.insert(table, row); await refresh(); return saved; }, [table, refresh]);
  const patch = useCallback(async (id, p) => { const saved = await db.update(table, id, p); await refresh(); return saved; }, [table, refresh]);
  const del = useCallback(async id => { await db.remove(table, id); await refresh(); }, [table, refresh]);

  return { items, loading, error, refresh, add, patch, del };
}

export function todayStr(d = new Date()) {
  const z = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}
