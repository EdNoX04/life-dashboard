import React, { useMemo, useState } from 'react';
import { useCollection } from '../lib/hooks.js';
import { Card, Empty, RefreshButton } from '../components/ui.jsx';
import { splitTicker } from '../../scripts/lib/newsfeed.mjs';

// The four tabs answer different questions, so they do not all want the same row.
//
// ALL is a scan: you are looking for anything worth opening, and a wall of
// paragraphs makes that harder rather than easier. Titles only.
//
// MY STOCKS and TECH are read: you have chosen a subject and now want to know
// what happened without leaving for the source. Both show the gist, and MY
// STOCKS additionally names the holding, because "Nvidia beats" is only useful
// once you know it is YOUR position that moved.
//
// The gist lives in the row already — the tab has always rendered n.summary. It
// was blank because nothing wrote it. See scripts/lib/newsfeed.mjs.
const CATS = [
  { key: 'all', label: 'ALL', gist: false, empty: 'No headlines yet — they arrive with the morning brief.' },
  { key: 'stocks', label: 'MY STOCKS', gist: true, empty: 'No stories about your holdings in the last few days. This feed needs a Finnhub key in Settings.' },
  { key: 'finance', label: 'FINANCE', gist: true, empty: 'No market news stored yet. The next morning brief fills this in.' },
  { key: 'tech', label: 'TECH', gist: true, empty: 'No tech stories stored yet. The next morning brief fills this in.' },
];

const CHIP = { stocks: 'c-green', finance: 'c-orange', tech: 'c-cyan' };

function Row({ item, gist }) {
  // The ticker is stored as a "[NVDA] " prefix on the title rather than as its
  // own column. Parsing it here keeps the headline readable and turns the
  // ticker into something the eye can land on.
  const { ticker, title } = useMemo(() => splitTicker(item.title), [item.title]);
  const summary = gist ? (item.summary || '').trim() : '';

  return (
    <div className="news-row">
      <div className="news-head">
        {ticker && <span className="chip c-green news-tick">{ticker}</span>}
        <a href={item.url} target="_blank" rel="noreferrer" className="news-title">{title}</a>
      </div>
      {gist && (
        summary
          ? <p className="news-gist">{summary}</p>
          // Saying so beats showing nothing: a missing gist then reads as a
          // property of that one story rather than as the tab being broken.
          : <p className="news-gist news-gist-none">No summary supplied by {item.source || 'the source'} — open the story for the detail.</p>
      )}
      <div className="news-meta">
        <span className={`chip ${CHIP[item.category] || 'c-purple'}`}>{item.category}</span>
        {item.source && <span className="chip">{item.source}</span>}
      </div>
    </div>
  );
}

export default function News() {
  const { items, refresh } = useCollection('news', { order: 'published_at' });
  const [cat, setCat] = useState('all');
  const active = CATS.find(c => c.key === cat) || CATS[0];

  const counts = useMemo(() => {
    const c = {};
    for (const n of items) c[n.category] = (c[n.category] || 0) + 1;
    return c;
  }, [items]);

  const shown = cat === 'all' ? items : items.filter(n => n.category === cat);

  return (
    <>
      <div className="spread">
        <h1 className="tab-title">NEWS</h1>
        <RefreshButton source="news" onLocalRefresh={refresh} />
      </div>
      <p className="tab-sub">Finance + tech + your holdings — curated by Cowork on schedule.</p>

      <div className="flex" style={{ marginBottom: 14 }}>
        {CATS.map(c => (
          <button
            key={c.key}
            className={`btn btn-sm ${cat === c.key ? 'btn-pink' : ''}`}
            onClick={() => setCat(c.key)}
          >
            {c.label}
            {/* The count sits on the tab so an empty category is visibly empty
                before you click it, rather than after. */}
            {c.key !== 'all' && <span className="news-count">{counts[c.key] || 0}</span>}
          </button>
        ))}
      </div>

      <Card title={`${active.label} (${shown.length})`} color="var(--cyan)">
        {shown.length === 0
          ? <Empty icon="※" text={active.empty} />
          : shown.map(n => <Row key={n.id} item={n} gist={active.gist} />)}
      </Card>
    </>
  );
}
