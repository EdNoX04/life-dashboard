import React, { useMemo } from 'react';
import { agendaFor, nextUp } from '../lib/agenda.js';

// The one line that answers "what is about to want me?" — across everything.
//
// Before this, three places answered that question from three different
// subsets: HQ counted tomorrow's classes, NextMeeting knew only about meetings,
// and the notifier watched classes and todos. None of them could tell you that
// the next thing on your day was a meeting DURING a class, because none of them
// held both.
//
// It is a strip rather than a card on purpose. A card implies you go and read
// it; this is meant to be caught out of the corner of an eye on the way to
// something else, which is also why it says one thing and stops.

const SRC = {
  class:   { label: 'CLASS',   color: 'var(--purple)' },
  meeting: { label: 'MEETING', color: 'var(--cyan)' },
  event:   { label: 'EVENT',   color: 'var(--orange)' },
  todo:    { label: 'TASK',    color: 'var(--green)' },
};

const when = n => {
  if (n.live) return 'now';
  if (n.inMin < 1) return 'starting';
  if (n.inMin < 60) return `in ${n.inMin}m`;
  const h = Math.floor(n.inMin / 60), m = n.inMin % 60;
  return `in ${h}h${m ? ` ${m}m` : ''}`;
};

export default function UpNext({ dayView, events = [], meetings = [], todos = [], now = Date.now() }) {
  const { next, clashes } = useMemo(() => {
    const day = agendaFor(dayView?.iso, { classes: dayView, events, meetings, todos });
    return { next: nextUp(day.items, now), clashes: day.conflicts };
  }, [dayView, events, meetings, todos, now]);

  // Nothing left today is a real and pleasant answer, but it is not worth a
  // row of chrome — the rest of HQ is more useful than a line saying "nothing".
  if (!next && !clashes.length) return null;

  const s = SRC[next?.source] || SRC.event;
  return (
    <div className="upnext" style={{ borderColor: s.color }}>
      {next && (
        <>
          <span className="chip" style={{ color: s.color, borderColor: s.color }}>{s.label}</span>
          <b className="upnext-title">{next.title}</b>
          {/* The room is the thing you actually need in the ninety seconds
              before a class, and a CHANGED room is the thing you need most —
              so it is said here, not left in the College tab. */}
          {next.where && <span className="upnext-where">{next.where}</span>}
          {next.meta?.change === 'room' && next.meta.usualRoom && (
            <span className="upnext-moved">moved — usually {next.meta.usualRoom}</span>
          )}
          <span className={`upnext-when${next.live ? ' live' : ''}`}>{when(next)}</span>
          {next.url && <a className="btn btn-sm" href={next.url} target="_blank" rel="noreferrer">Join</a>}
        </>
      )}
      {clashes.length > 0 && (
        <span className="upnext-clash" title={clashes.map(([a, b]) => `${a.title} × ${b.title}`).join('\n')}>
          ⚠ {clashes.length === 1
            ? `${clashes[0][0].title} × ${clashes[0][1].title} are at the same time`
            : `${clashes.length} things are double-booked today`}
        </span>
      )}
    </div>
  );
}
