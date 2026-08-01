import React from 'react';
import { Card, Empty } from '../components/ui.jsx';
import { useCollection } from '../lib/hooks.js';
import { announcementLink } from '../lib/whatsapp.js';

// Clean slate — TCS-NQT content removed. This will be rebuilt with company
// registrations (synced from college announcements), drives and interview prep.
export default function Placement() {
  const { items: annc } = useCollection('announcements', { order: 'date' });
  const drives = annc.filter(a => /placement|drive|company|registration|hiring|recruit|intern/i.test(`${a.title} ${a.body || ''}`));

  return (
    <>
      <h1 className="tab-title">PLACEMENT</h1>
      <p className="tab-sub">Company registrations, drives and interview prep.</p>

      <Card title="Company registrations & drives" color="var(--pink)">
        {drives.length === 0 && <Empty icon="🏢" text="No drives yet. Once college announcements sync in, company registrations and drive dates will land here with their links." />}
        {/* a.link was read here for months and was always undefined — the
            announcements table has no link column. The URL is in the body,
            where the original message put it, so that is where it is read from. */}
        {drives.slice(0, 20).map(a => {
          const href = announcementLink(a);
          return (
            <div className="row" key={a.id}>
              <span style={{ flex: 1 }}>{a.title}</span>
              {href && <a className="btn btn-sm btn-cyan" href={href} target="_blank" rel="noreferrer">open</a>}
              <span className="chip c-purple">{a.date}</span>
            </div>
          );
        })}
      </Card>

      <Card title="Interview prep" color="var(--cyan)">
        <Empty icon="🎤" text="Rebuild this with what you need — DSA rounds, CS fundamentals (OS/DBMS/OOP/Networks), project deep-dives, HR questions and mock rounds." />
      </Card>
    </>
  );
}
