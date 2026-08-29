import { useCallback, useState } from 'react';
import { useCollection } from './hooks.js';
import * as db from './db.js';
import { DONE_KEY, withDone } from './reminders.js';

// The one place that reads and writes memory.reminder_done.
//
// HQ and Study both show the Spanish modules, and "done" has to mean the same
// thing on both — tick it on either screen and the other agrees, immediately.
// The alternative is two components each holding their own copy of the map and
// each writing the whole blob back, which is a lost update the first time both
// are mounted: the second write is built from a map that predates the first.
//
// `reminders.js` stays pure so it can be tested under plain node; this file is
// the React-and-network half.
export function useReminderDone() {
  const { items, refresh } = useCollection('memory', { filter: `key=eq.${DONE_KEY}`, order: 'key' });
  const doneMap = items?.[0]?.value || {};
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState('');

  const setDone = useCallback(async (key, on) => {
    if (!key) return;
    setBusy(key); setErr('');
    try {
      // Whole blob, built from a fresh copy — see withDone's note on not
      // mutating: a failed write must leave the on-screen state alone rather
      // than showing a tick that evaporates on the next refresh.
      await db.upsertMemory(DONE_KEY, withDone(doneMap, key, on));
      await refresh();
    } catch (e) {
      setErr(String(e.message || e));
    } finally {
      setBusy(null);
    }
  }, [doneMap, refresh]);

  return { doneMap, setDone, busy, err };
}
