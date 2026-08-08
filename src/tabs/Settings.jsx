import React, { useState } from 'react';
import { Card, StatTile } from '../components/ui.jsx';
import { getConfig, setConfig, isRemote, syncPushConfig } from '../lib/db.js';
import { useCollection } from '../lib/hooks.js';
import { THEMES, getTheme, setTheme } from '../lib/theme.js';
import SyncStatus from '../components/SyncStatus.jsx';

export default function Settings() {
  const [cfg, setCfg] = useState(getConfig());
  const [saved, setSaved] = useState(false);
  const [theme, setThemeState] = useState(getTheme());

  function pickTheme(id) {
    setTheme(id);            // applies instantly + persists to config
    setThemeState(id);
    syncPushConfig().catch(() => {});
  }
  const { items: requests } = useCollection('requests');
  const { items: usageMem } = useCollection('memory', { filter: 'key=eq.ai_usage', order: 'key' });
  const usage = usageMem?.[0]?.value || {};

  function save() {
    setConfig(cfg);
    // sync market/TMDB/LeetCode keys to your other devices, then nudge the live engine
    syncPushConfig().catch(() => {});
    window.dispatchEvent(new Event('ldx-config-synced'));
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  }

  const upd = k => e => setCfg({ ...cfg, [k]: e.target.value.trim() });

  return (
    <>
      <h1 className="tab-title">SETTINGS</h1>
      <p className="tab-sub">Theme, keys and how the dashboard stays live.</p>

      <Card title="Theme" color="var(--pink)">
        <div className="small muted" style={{ marginBottom: 10, lineHeight: 1.5 }}>
          Recolor the whole app. Tap one — it applies instantly and follows you across devices.
        </div>
        <div className="theme-grid">
          {THEMES.filter(t => t.cat === 'normal').map(t => (
            <button key={t.id} className={`theme-card${theme === t.id ? ' on' : ''}`} onClick={() => pickTheme(t.id)}>
              <span className="theme-swatch">{t.swatch.map((c, i) => <i key={i} style={{ background: c }} />)}</span>
              <span className="theme-name">{t.name}</span>
              <span className="theme-note">{t.note}</span>
              {theme === t.id && <span className="theme-on">✓</span>}
            </button>
          ))}
        </div>

        <div className="theme-season-h"><span className="theme-season-ico">❄</span> Seasonal <span className="small muted">— special picks</span></div>
        <div className="theme-grid">
          {THEMES.filter(t => t.cat === 'season').map(t => (
            <button key={t.id} className={`theme-card season${theme === t.id ? ' on' : ''}`} onClick={() => pickTheme(t.id)}>
              <span className="theme-swatch">{t.swatch.map((c, i) => <i key={i} style={{ background: c }} />)}</span>
              <span className="theme-name">{t.name}</span>
              <span className="theme-note">{t.note}</span>
              {theme === t.id && <span className="theme-on">✓</span>}
            </button>
          ))}
        </div>
      </Card>

      <Card title={`Data mode: ${isRemote() ? 'SUPABASE (live)' : 'LOCAL (this device only)'}`} color={isRemote() ? 'var(--green)' : 'var(--yellow)'}>
        <label>Supabase URL</label>
        <input placeholder="https://xxxx.supabase.co" defaultValue={cfg.supabaseUrl || ''} onChange={upd('supabaseUrl')} />
        <label className="mt">Supabase publishable key (a.k.a. anon key, sb_publishable_…)</label>
        <input placeholder="eyJhbGciOi…" defaultValue={cfg.supabaseKey || ''} onChange={upd('supabaseKey')} />
        <label className="mt">TMDB API key (movie search & posters — free)</label>
        <input placeholder="optional" defaultValue={cfg.tmdbKey || ''} onChange={upd('tmdbKey')} />
        <div className="flex mt">
          <button className="btn btn-green" onClick={save}>{saved ? 'Saved ✓' : 'Save'}</button>
          <span className="small muted">After saving, reload the page. Local data stays as a fallback.</span>
        </div>
      </Card>

      <Card title="Live market data (free keys)" color="var(--pink)">
        <div className="small muted" style={{ marginBottom: 8, lineHeight: 1.5 }}>
          Powers real-time prices, today's 1D P&L and the retro charts. Both free — sign up with email, paste the key, Save, reload.
        </div>
        <label>Finnhub API key — live prices + 1D P&L (<a href="https://finnhub.io/register" target="_blank" rel="noreferrer" style={{ color: 'var(--cyan)' }}>finnhub.io/register</a>)</label>
        <input placeholder="paste Finnhub key" defaultValue={cfg.finnhubKey || ''} onChange={upd('finnhubKey')} />
        <label className="mt">Twelve Data API key — retro candlestick charts (<a href="https://twelvedata.com/pricing" target="_blank" rel="noreferrer" style={{ color: 'var(--cyan)' }}>twelvedata.com</a>, Basic/free)</label>
        <input placeholder="paste Twelve Data key" defaultValue={cfg.twelveKey || ''} onChange={upd('twelveKey')} />
        <label className="mt">Financial Modeling Prep key — dividend history, calendar and payout ratios (<a href="https://site.financialmodelingprep.com/developer/docs" target="_blank" rel="noreferrer" style={{ color: 'var(--cyan)' }}>financialmodelingprep.com</a>, free tier)</label>
        <input placeholder="paste FMP key" defaultValue={cfg.fmpKey || ''} onChange={upd('fmpKey')} />
        <label className="mt">Alpha Vantage key — fallback for the ETFs FMP&#39;s free plan refuses (<a href="https://www.alphavantage.co/support/#api-key" target="_blank" rel="noreferrer" style={{ color: 'var(--cyan)' }}>alphavantage.co</a>, free)</label>
        <input placeholder="paste Alpha Vantage key" defaultValue={cfg.alphaKey || ''} onChange={upd('alphaKey')} />
        {/* Stated as a fallback, not a second primary. 25 requests a day cannot
            carry twenty holdings; it is exactly enough for the handful the
            first source refuses. */}
        <div className="small muted" style={{ marginTop: 4, lineHeight: 1.5 }}>
          Only used for tickers FMP declines — SCHD, VOO, QQQ, QQQM, SPMO and a few
          others. 25 requests a day, which is ample for a handful of symbols whose
          dividends change quarterly. Whether its free tier covers ETFs is not
          documented clearly; the screen will name which source answered, so one
          refresh settles it.
        </div>
        {/* Said here rather than discovered later: the free plan's two real
            limits both change what the dividend screens can honestly show. */}
        <div className="small muted" style={{ marginTop: 4, lineHeight: 1.5 }}>
          Free tier is 250 requests a day and US listings only. Dividend history is
          cached for a week and refreshed behind a button, so twenty holdings costs
          roughly eighty requests a month. An Indian holding will come back empty —
          the screens report that as &ldquo;not covered&rdquo;, never as &ldquo;pays nothing&rdquo;.
        </div>
        <div className="flex mt">
          <button className="btn btn-green" onClick={save}>{saved ? 'Saved ✓' : 'Save'}</button>
          <span className="small muted">Live prices stream only while the US market is open (9:30–16:00 ET).</span>
        </div>
        {/* Where a key lives is a security decision, not a convenience one. The
            keys above are read-only market-data keys and are safe in the
            browser. A Binance key can see your balances and history, so it goes
            into GitHub Secrets where only the scheduled worker can read it -
            never into this page, and never into the database. */}
        <div className="small muted mt" style={{ lineHeight: 1.55, borderTop: '1px dotted var(--border)', paddingTop: 8 }}>
          <b style={{ color: 'var(--ink-2)', fontWeight: 'normal' }}>Binance is different.</b> It
          does not go here. Add <code>BINANCE_API_KEY</code> and <code>BINANCE_API_SECRET</code> to
          your repo&#39;s GitHub Secrets instead, so only the scheduled worker can read
          them and they never reach the browser. Create the key with{' '}
          <b style={{ color: 'var(--green)', fontWeight: 'normal' }}>Enable Reading only</b> —
          Spot Trading and Withdrawals off, and no IP allow-list, because Actions
          runners have no fixed address.
        </div>
      </Card>

      <Card title="AI providers (any key works)" color="var(--purple)">
        <div className="small muted" style={{ marginBottom: 8, lineHeight: 1.5 }}>
          Add a key for whichever provider you use — the AI features (summaries, notes, decision engine) pick up whichever is set. Keys stay in this browser and sync to your devices.
        </div>
        <label>Anthropic (Claude) key</label>
        <input placeholder="sk-ant-…" defaultValue={cfg.claudeKey || ''} onChange={upd('claudeKey')} />
        <label className="mt">OpenAI (ChatGPT) key</label>
        <input placeholder="sk-…" defaultValue={cfg.openaiKey || ''} onChange={upd('openaiKey')} />
        <label className="mt">Google (Gemini) key</label>
        <input placeholder="AIza…" defaultValue={cfg.geminiKey || ''} onChange={upd('geminiKey')} />
        <div className="flex mt">
          <button className="btn btn-green" onClick={save}>{saved ? 'Saved ✓' : 'Save'}</button>
          <span className="small muted">Preferred provider auto-selects from whichever key is present.</span>
        </div>
      </Card>

      <Card title="AI usage & estimated cost" color="var(--yellow)">
        <div className="tile-row" style={{ marginBottom: 0 }}>
          <StatTile label="Calls" value={usage.calls || 0} note="this month" color="var(--cyan)" />
          <StatTile label="Tokens" value={(usage.tokens || 0).toLocaleString()} color="var(--purple)" />
          <StatTile label="Est. cost" value={'$' + (usage.cost || 0).toFixed(3)} note="live estimate" color="var(--green)" />
        </div>
        <div className="small muted mt">Every AI call logs its tokens × the provider's per-token price, updating this running monthly estimate live. Activates once the AI features start making calls.</div>
      </Card>

      <SyncStatus />

      <Card title="Request queue (Cowork inbox)" color="var(--purple)">
        {requests.length === 0 && <div className="muted small">No requests yet. Refresh buttons and Ask-Cowork land here.</div>}
        {requests.slice(0, 10).map(r => (
          <div className="row" key={r.id}>
            <span className="chip c-cyan">{r.kind}</span>
            <span style={{ flex: 1 }} className="small">{JSON.stringify(r.payload).slice(0, 80)}</span>
            <span className={`chip ${r.status === 'done' ? 'c-green' : r.status === 'pending' ? 'c-yellow' : 'c-purple'}`}>{r.status}</span>
          </div>
        ))}
      </Card>

      <Card title="How this stays live" color="var(--cyan)">
        <div className="small" style={{ color: 'var(--ink-2)', lineHeight: 1.5 }}>
          Dashboard ⇄ Supabase (instant reads/writes, 45s polling for new data).<br />
          Cowork's scheduled cloud runs fill Supabase: Amizone sync, prices, news, morning brief, roadmaps, exam notes, midnight builds.<br />
          Manual refresh buttons queue a request so the next run re-pulls that source.
        </div>
      </Card>
    </>
  );
}
