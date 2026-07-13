# LIFE HQ — Neel's everything dashboard

Retro pixel, dark pink/purple. React (Vite) + Supabase + Cowork as the brain.

## Architecture

```
iPhone / any browser
      │
      ▼
 Vercel (React PWA) ⇄ Supabase (Postgres + REST)
                          ▲
                          │  scheduled cloud runs
                     Cowork (the brain)
        amizone · prices · news · briefs · roadmaps
        exam notes · midnight builds · maintenance
```

- The dashboard reads/writes Supabase directly (plain PostgREST fetch — no SDK).
- Cowork's scheduled runs fill Supabase and answer `requests` rows
  (Ask-Cowork box + every manual Refresh button writes there).
- Local mode: with no Supabase keys the app runs 100% on localStorage.

## Setup (one time)

1. **Supabase**: create a free project at supabase.com → SQL editor →
   paste `supabase/schema.sql` → Run.
2. **Vercel**: import this GitHub repo → framework preset: Vite → Deploy.
3. Open the deployed site → **Config tab** → paste Supabase URL + anon key
   (Project Settings → API). Optional: TMDB key for movie search.
4. iPhone: open the site in Safari → Share → **Add to Home Screen**.

## Dev

```
npm install
npm run dev
```

## Structure

```
src/
  lib/db.js        data layer: Supabase REST + localStorage fallback
  lib/hooks.js     useCollection (live polling CRUD)
  components/ui.jsx shared retro components (Card, StatTile, AskCowork…)
  tabs/            one file per tab (HQ, Todos, Habits, Goals, College,
                   Subjects, Money, Health, Journal, Movies, News, Builds,
                   Settings)
  theme.css        the whole retro design system
supabase/schema.sql  all tables + RLS
public/            PWA manifest + pixel icons
```

## Cowork request protocol

`requests` table rows: `{kind, payload, status}` —
- `ask`        {question}
- `refresh`    {source: amizone|investments|news|health}
- `roadmap`    {goal_id, goal, horizon}
- `exam_notes` {subject_id, subject, syllabus}
- `build`      {build_id, name}

Cowork picks up `pending` rows on scheduled runs → does the work →
writes results into the right tables → sets status `done`.
