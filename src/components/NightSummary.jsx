import React from 'react';

// The night summary, as HQ shows it after dark.
//
// Two things this component is careful about, both of which are the difference
// between a summary you trust and one you stop reading:
//
//   1. IT NEVER SHOWS YESTERDAY'S SUMMARY AS TONIGHT'S. The blob carries the
//      date it is about. If the job has not run yet this evening, the date will
//      not match, and a stale summary rendered without a word would be read as
//      tonight's — a wrong record, presented with total confidence.
//   2. WHAT WAS NOT MEASURED IS ON SCREEN. Quietly omitting a source makes the
//      page look complete. The footnote is small and grey on purpose: it is not
//      an error, it is the edge of what this system can see.

export default function NightSummary({ summary, today, fallback = null }) {
  const fresh = summary && summary.date === today;

  if (!fresh) {
    return (
      <div style={{ lineHeight: 1.6 }}>
        {fallback}
        <div className="small" style={{ color: 'var(--ink-3)', marginTop: 6 }}>
          {summary?.date
            ? `Counted live. Tonight's full summary lands at 22:30 — the last one written was for ${summary.date}.`
            : "Counted live. The full summary runs at 22:30 each night."}
        </div>
      </div>
    );
  }

  return (
    <div className="nightsum">
      {summary.headline && <div className="nightsum-head">{summary.headline}</div>}

      {summary.sections.map(s => (
        <div className="nightsum-sec" key={s.key}>
          <div className="nightsum-title">{s.title}</div>
          {/* pre-wrap rather than splitting into elements: the bodies are
              composed as text in nightly.js, which is also what the GitHub
              Actions log and any future notification show. One rendering of one
              string, so they cannot drift apart. */}
          <div className="nightsum-body">{s.body}</div>
        </div>
      ))}

      {summary.notMeasured?.length > 0 && (
        <div className="nightsum-gap">
          Not measured: {summary.notMeasured.map(g => g.what).join(', ')}.
          <span className="nightsum-why"> {summary.notMeasured.map(g => g.why).join(' · ')}</span>
        </div>
      )}

      {/* A read that failed TONIGHT is different from a source that has never
          existed, and only one of them is worth chasing — so it is said
          separately rather than folded into the line above. */}
      {summary.readFailures?.length > 0 && (
        <div className="nightsum-gap" style={{ color: 'var(--orange)' }}>
          Could not read tonight: {summary.readFailures.join('; ')}
        </div>
      )}
    </div>
  );
}
