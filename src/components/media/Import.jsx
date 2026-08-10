import React, { useState } from 'react';
import { Card } from '../ui.jsx';
import { parseCsv, csvKind } from '../../lib/letterboxd.js';
import { addViewing, validDate } from '../../lib/medialog.js';

// The CSV import — batch 7, and the last piece.
//
// The nightly sync reads your RSS feed, which carries roughly the last fifty
// diary entries. That is the right surface for keeping up to date and useless
// for history: anything older than the feed's window is simply not there, and no
// amount of re-running fetches it. The full record lives in the export
// (Letterboxd → Settings → Import & Export → Export your data), which is a zip
// of CSVs you download once.
//
// It runs in the browser rather than in CI because the file is on your machine
// and there is nothing to schedule. Nothing is uploaded anywhere: the file is
// read locally, parsed locally, and only the resulting viewings are written to
// your own database.
//
// The one thing this screen must not do is import quietly. A merge that silently
// doubles a diary, or that overwrites a review you wrote with a blank, is worse
// than no import — so it parses first, tells you exactly what it found, and
// waits.

const fmt = n => n.toLocaleString('en-IN');

export default function Import({ log = [], onMerge }) {
  const [preview, setPreview] = useState(null);
  const [err, setErr] = useState(null);
  const [done, setDone] = useState(null);
  const [busy, setBusy] = useState(false);

  const read = async file => {
    setErr(null); setDone(null); setPreview(null);
    if (!file) return;
    try {
      const text = await file.text();
      const kind = csvKind(text);
      if (kind === 'unknown') {
        setErr('That does not look like a Letterboxd export. The file you want is diary.csv, inside the zip from Settings → Import & Export.');
        return;
      }
      const rows = parseCsv(text);
      if (!rows.length) {
        setErr('The file parsed but held no rows.');
        return;
      }

      // What would actually change, worked out BEFORE anything is written. The
      // same addViewing the app uses, so the preview cannot disagree with the
      // result — a preview computed a different way is a preview that lies.
      // `fill` matters: an import must not overwrite a rating or review you
      // wrote here. Without it the claim printed below this preview would be
      // false — which a test caught before it shipped.
      let next = log;
      for (const r of rows) next = addViewing(next, r, { fill: true });
      const added = next.length - log.length;

      const dates = rows.map(r => validDate(r.on)).filter(Boolean).sort();
      setPreview({
        kind,
        rows: rows.length,
        added,
        already: rows.length - added,
        undated: rows.filter(r => !validDate(r.on)).length,
        rated: rows.filter(r => r.rating != null).length,
        from: dates[0] || null,
        to: dates[dates.length - 1] || null,
        merged: next,
        name: file.name,
      });
    } catch (e) {
      setErr(String(e.message || e));
    }
  };

  const apply = async () => {
    if (!preview) return;
    setBusy(true);
    try {
      await onMerge(preview.merged);
      setDone({ added: preview.added, total: preview.merged.length });
      setPreview(null);
    } catch (e) {
      setErr(String(e.message || e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Import from Letterboxd" color="var(--orange)">
      <p className="ml-hint" style={{ marginTop: 0 }}>
        The nightly sync reads your RSS feed, which only carries the last ~50
        diary entries. This is for everything older. In Letterboxd go to
        <b> Settings → Import &amp; Export → Export your data</b>, unzip it, and
        pick <code>diary.csv</code> below. The file is read here in your browser
        — it is not uploaded anywhere.
      </p>

      <input type="file" accept=".csv,text/csv" onChange={e => read(e.target.files?.[0])} />

      {err && <p className="ls-warn">{err}</p>}

      {preview && (
        <div className="im-prev">
          <div className="im-head">{preview.name}</div>

          {/* The distinction that decides whether this import is worth doing.
              watched.csv has one row per FILM; diary.csv has one per VIEWING.
              Import the wrong one and every rewatch silently disappears. */}
          {preview.kind === 'watched' ? (
            <p className="ls-warn">
              This is <b>watched.csv</b>, which has one row per film and no watch
              dates — so every rewatch is lost and the dates below are when you
              logged each film, not when you saw it. <b>diary.csv</b> from the
              same zip is the one with real dates. You can import this anyway; it
              will fill in films you have never logged.
            </p>
          ) : (
            <p className="im-ok">diary.csv — one row per viewing, so rewatches survive.</p>
          )}

          <div className="im-grid">
            <span><b>{fmt(preview.rows)}</b> rows in the file</span>
            <span><b>{fmt(preview.added)}</b> new viewings</span>
            <span><b>{fmt(preview.already)}</b> already recorded</span>
            <span><b>{fmt(preview.rated)}</b> carry a rating</span>
            {preview.undated > 0 && <span><b>{fmt(preview.undated)}</b> without a usable date</span>}
            {preview.from && <span>covering <b>{preview.from}</b> to <b>{preview.to}</b></span>}
          </div>

          <p className="ml-hint">
            Nothing you have written is overwritten: an import fills in fields
            that are empty and leaves your own ratings, notes and reviews alone.
            Viewings already recorded are matched on title and date, so importing
            the same file twice changes nothing the second time.
          </p>

          <div className="flex" style={{ gap: 8 }}>
            <button className="btn" onClick={() => setPreview(null)}>CANCEL</button>
            <button className="btn btn-green" onClick={apply} disabled={busy || preview.added === 0}>
              {busy ? 'WRITING…' : preview.added === 0 ? 'NOTHING NEW TO ADD' : `IMPORT ${fmt(preview.added)} VIEWINGS`}
            </button>
          </div>
        </div>
      )}

      {done && (
        <p className="im-ok">
          Imported {fmt(done.added)} viewings. Your diary now holds {fmt(done.total)}.
        </p>
      )}
    </Card>
  );
}
