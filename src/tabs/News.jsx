import React, { useEffect, useMemo, useState } from 'react';
import { useCollection } from '../lib/hooks.js';
import { Card, Empty, RefreshButton } from '../components/ui.jsx';
import { splitTicker } from '../../scripts/lib/newsfeed.mjs';
import { fetchHoldingsNews, fetchCategoryNews } from '../lib/news.js';
import { getConfig } from '../lib/db.js';

// The four tabs answer different questions, so they do not all draw the same row.
//
// ALL is a scan: you want to spot something worth opening, and a wall of
// paragraphs makes that harder. Titles only.
//
// MY STOCKS, FINANCE and TECH are a read: you have picked a subject and want to
// know what happened without leaving for the source. All three show the gist,
// and MY STOCKS additionally names the holding, because "Nvidia beats" only
// means something once you know it is YOUR position that moved.
//
// Where the rows come from changed for a reason. The stored `news` table is
// written by the nightly brief, and rows already sitting in it do not fix
// themselves — every row written before this week carries summary: '' and no
// ticker. So the tab now fetches Finnhub directly and merges: live rows win,
// stored rows fill in behind. Finnhub is CORS-friendly and carries summaries;
// Google News RSS is not, which is why it stays in the worker.
const CATS = [
  { key: 'all', label: 'ALL', gist: false },
  { key: 'stocks', label: 'MY STOCKS', gist: true },
  { key: 'finance', label: 'FINANCE', gist: true },
  { key: 'tech', label: 'TECH', gist: true },
];

const CHIP = { stocks: 'c-green', finance: 'c-orange', tech: 'c-cyan' };

function Row({ item, gist }) {
  // A live row carries `ticker` as a field. A stored row hides it in the title
  // as "[NVDA] ", because the news table has no ticker column. Either way the
  // headline that gets rendered is the clean one.
  const parsed = useMemo(() => splitTicker(item.title), [item.title]);
  const ticker = item.ticker || parsed.ticker;
  const title = parsed.title;
  const summary = gist ? (item.summary || '').trim() : '';

  return (
    <div className="news-row">
      <div className="news-head">
        {ticker && <span className="chip c-green news-tick">{ticker}</span>}
        <a href={item.url} target="_blank" rel="noreferrer" className="news-title">{title}</a>
      </div>

      {/* Said in words, not just as a chip. A chip is a label you have to learn
          to read; this is the sentence the tab exists to say. */}
      {gist && ticker && (
        <p className="news-about">About your <strong>{ticker}</strong> position</p>
      )}

      {gist && (
        summary
          ? <p className="news-gist">{summary}</p>
          : <p className="news-gist news-gist-none">
              No summary supplied by {item.source || 'the source'} — open the story for the detail.
            </p>
      )}

      <div className="news-meta">
        <span className={`chip ${CHIP[item.category] || 'c-purple'}`}>{item.category}</span>
        {item.source && <span className="chip">{item.source}</span>}
      </div>
    </div>
  );
}

export default function News() {
  const { items: stored, refresh } = useCollection('news', { order: 'published_at' });
  const { items: holdings } = useCollection('investments', { order: 'ticker', asc: true });
  const [cat, setCat] = useState('all');
  const [live, setLive] = useState([]);
  const [loading, setLoading] = useState(false);
  const hasKey = !!(getConfig().finnhubKey || '').trim();

  const tickers = useMemo(
    () => holdings.filter(h => Number(h.qty) > 0).map(h => h.ticker).filter(Boolean),
    [holdings],
  );
  const tickerKey = tickers.slice().sort().join(',');

  useEffect(() => {
    if (!hasKey) return;
    let dead = false;
    setLoading(true);
    Promise.all([
      fetchHoldingsNews(tickerKey ? tickerKey.split(',') : []),
      fetchCategoryNews('finance'),
      fetchCategoryNews('tech'),
    ])
      .then(([a, b, c]) => { if (!dead) setLive([...a, ...b, ...c]); })
      .catch(() => {})
      .finally(() => { if (!dead) setLoading(false); });
    return () => { dead = true; };
  }, [tickerKey, hasKey]);

  // Live rows win on collision. A stored row is a snapshot of what the brief
  // saw hours ago; a live one is what the source says now, and it is the one
  // carrying the summary.
  const merged = useMemo(() => {
    const byUrl = new Map();
    for (const n of live) byUrl.set(String(n.url).split('?')[0], n);
    for (const n of stored) {
      const k = String(n.url).split('?')[0];
      if (!byUrl.has(k)) byUrl.set(k, n);
    }
    return [...byUrl.values()].sort((a, b) =>
      String(b.published_at || '').localeCompare(String(a.published_at || '')));
  }, [live, stored]);

  const counts = useMemo(() => {
    const c = {};
    for (const n of merged) c[n.category] = (c[n.category] || 0) + 1;
    return c;
  }, [merged]);

  const active = CATS.find(c => c.key === cat) || CATS[0];
  const shown = cat === 'all' ? merged : merged.filter(n => n.category === cat);

  // An empty tab should say which of the several possible reasons applies,
  // because "no key", "no holdings" and "nothing published" need different
  // things from the reader.
  const emptyText = () => {
    if (!hasKey) return 'Add a Finnhub key in Settings — that is what fills Finance, Tech and your holdings feed.';
    if (loading) return 'Fetching…';
    if (cat === 'stocks' && !tickers.length) return 'No holdings recorded yet, so there is nothing to follow. Add positions in the Money tab.';
    return 'Nothing published in the last few days for this category.';
  };

  return (
    <>
      <div className="spread">
        <h1 className="tab-title">NEWS</h1>
        <RefreshButton source="news" onLocalRefresh={refresh} />
      </div>
      <p className="tab-sub">Finance + tech + your holdings — live from Finnhub, topped up by the morning brief.</p>

      <div className="flex" style={{ marginBottom: 14 }}>
        {CATS.map(c => (
          <button
            key={c.key}
            className={`btn btn-sm ${cat === c.key ? 'btn-pink' : ''}`}
            onClick={() => setCat(c.key)}
          >
            {c.label}
            {c.key !== 'all' && <span className="news-count">{counts[c.key] || 0}</span>}
          </button>
        ))}
      </div>

      <Card
        title={`${active.label} (${shown.length})`}
        color="var(--cyan)"
        right={loading ? <span className="chip c-yellow">LOADING</span> : null}
      >
        {shown.length === 0
          ? <Empty icon="※" text={emptyText()} />
          : shown.map(n => <Row key={n.id} item={n} gist={active.gist} />)}
      </Card>
    </>
  );
}
