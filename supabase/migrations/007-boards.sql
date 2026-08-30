-- 007 — a table for Excalidraw boards.
--
-- The Notes tab kept its drawings in React state and nowhere else: no table, no
-- memory row, not even localStorage. Switching tabs threw the drawing away, and
-- the multi-page controls and PDF export made that look like a notebook rather
-- than the scratchpad it was.
--
-- A table rather than a `memory` blob, which is what everything else here uses.
-- Drawings are the one thing in this app that get genuinely large — a page of
-- handwriting is thousands of points — and a single blob means every board is
-- fetched to open one, and one big board eventually breaks all of them.
--
-- Run this BEFORE deploying the new Notes tab. It only adds; nothing existing
-- reads or writes this table.

create table if not exists public.boards (
  id          uuid primary key default gen_random_uuid(),
  name        text not null default 'Untitled',
  -- The Excalidraw scene: { elements, appState }. Stored whole rather than
  -- normalised, because it is Excalidraw's format to change, not ours.
  scene       jsonb not null default '{}'::jsonb,
  -- A PNG data URL for the board list. Optional: a list of boards you cannot
  -- tell apart is a list you scroll rather than use.
  thumb       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists boards_updated_idx on public.boards (updated_at desc);

-- RLS, matching every other table. 006 looped over the tables that existed at
-- the time; a new table starts with RLS enabled and NO policy, which denies
-- everything — including Neel — so its policy has to be created here.
alter table public.boards enable row level security;
drop policy if exists "authenticated full access" on public.boards;
create policy "authenticated full access" on public.boards
  for all to authenticated using (true) with check (true);

-- Verify: one row, roles {authenticated}, and nothing for anon.
-- select tablename, policyname, roles from pg_policies
-- where schemaname = 'public' and tablename = 'boards';
