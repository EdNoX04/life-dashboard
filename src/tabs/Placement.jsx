import React from 'react';
import { Card, Empty, StatTile } from '../components/ui.jsx';

// TEMPORARY tab — placement season. Auto-hidden by App after PLACEMENT_EXPIRY.
// SCAFFOLD: sections laid out; the tracker + prep tools get built in the deep pass.
export const PLACEMENT_EXPIRY = new Date('2027-12-31T23:59:59');

export default function Placement({ go }) {
  const daysLeft = Math.max(0, Math.ceil((PLACEMENT_EXPIRY - new Date()) / 864e5));

  return (
    <>
      <div className="spread">
        <h1 className="tab-title">PLACEMENT</h1>
        <span className="chip c-yellow">⏳ {daysLeft} days · till Dec 31 ’27</span>
      </div>
      <p className="tab-sub">Prep → apply → land it. A temporary war-room for placement season.</p>

      <div className="tile-row">
        <StatTile label="Applications" value="—" note="tracked" color="var(--cyan)" />
        <StatTile label="In progress" value="—" note="OA / interview" color="var(--yellow)" />
        <StatTile label="Offers" value="—" note="🎉" color="var(--green)" />
        <StatTile label="Prep streak" value="—" note="days" color="var(--pink)" />
      </div>

      <Card title="Prep" color="var(--green)">
        <Empty icon="🎯" text="Resume/CV checklist, DSA & aptitude drills (links into your DSA Arena), core-CS topics, and mock-interview practice — tracked so you know what's solid and what's shaky." />
      </Card>

      <Card title="Company research & advice" color="var(--purple)">
        <Empty icon="🏢" text="Per-company notes: role, CTC, rounds, cutoff, questions asked. Plus tailored advice on timeline, what to grind next, and where you stand." />
      </Card>

      <Card title="Applications tracker" color="var(--cyan)">
        <Empty icon="📋" text="Add a company and move it through stages — Applied → OA → Interview → Offer/Reject — with dates and next-action reminders." />
      </Card>

      <Card title="Timeline" color="var(--yellow)">
        <Empty icon="🗓" text="Key dates: registration deadlines, test windows, interview days — merged with your calendar so nothing slips." />
      </Card>
    </>
  );
}
