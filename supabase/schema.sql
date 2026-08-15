-- ================= LIFE HQ — Supabase schema =================
-- Run this once in the Supabase SQL editor (Dashboard → SQL → New query).
-- Single-user app: RLS is enabled with permissive anon policies for now.
-- Phase 2 hardens this with Supabase Auth.

create extension if not exists "pgcrypto";

-- helper: standard columns
-- every table: id uuid pk, created_at timestamptz

create table if not exists todos (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  title text not null,
  notes text,
  due_date date,
  list text default 'Inbox',
  priority int default 0,
  completed boolean default false,
  completed_at timestamptz
);

create table if not exists habits (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  name text not null,
  category text default 'General',
  archived boolean default false
);

create table if not exists habit_logs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  habit_id uuid references habits(id) on delete cascade,
  date date not null
);

create table if not exists goals (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  title text not null,
  horizon text check (horizon in ('short','long','lifelong')),
  status text default 'active',
  progress int default 0,
  roadmap jsonb default '[]'::jsonb
);

create table if not exists journal (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  content text not null,
  mood text
);

create table if not exists movies (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  title text not null,
  type text default 'movie',
  status text default 'watchlist',
  rating int,
  tmdb_id bigint,
  poster_url text,
  notes text
);

create table if not exists subjects (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  name text not null,
  code text,
  syllabus text,
  attendance_pct numeric,
  notes_url text,
  notes_status text
);

create table if not exists timetable (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  day text,
  start_time text,
  end_time text,
  subject text,
  room text,
  faculty text
);

create table if not exists announcements (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  title text,
  body text,
  source text default 'amizone',
  date date
);

create table if not exists investments (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  ticker text not null,
  name text,
  qty numeric,
  avg_cost numeric,
  last_price numeric,
  currency text default 'USD',
  source text default 'manual',
  updated_at timestamptz default now()
);

create table if not exists portfolio_snapshots (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  date date,
  total_value numeric,
  total_cost numeric,
  detail jsonb
);

create table if not exists health_metrics (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  date date,
  metric text,          -- steps | sleep_hours | resting_hr | active_energy | insight | ...
  value text,
  unit text,
  note text,
  source text default 'manual'
);

create table if not exists workouts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  date date,
  title text,
  duration_min int,
  volume_kg numeric,
  exercises jsonb default '[]'::jsonb,
  source text default 'manual'  -- manual | hevy
);

create table if not exists news (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  title text,
  url text,
  source text,
  category text,        -- stocks | finance | tech
  summary text,
  published_at timestamptz default now()
);

create table if not exists briefs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  date date unique,
  sections jsonb default '[]'::jsonb   -- [{title, body}]
);

create table if not exists builds (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  name text not null,
  kind text default 'APP',
  status text default 'pending',       -- pending | in_progress | done | failed
  notes text,
  repo_url text,
  updated_at timestamptz default now()
);

-- Cowork inbox: the dashboard writes requests, Cowork's scheduled runs
-- pick up pending rows, act, write response, mark done.
create table if not exists requests (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  kind text,                            -- ask | refresh | roadmap | exam_notes | build
  payload jsonb default '{}'::jsonb,
  status text default 'pending',        -- pending | working | done | failed
  response text,
  resolved_at timestamptz
);

-- generic key-value memory for Cowork
create table if not exists memory (
  key text primary key,
  value jsonb,
  updated_at timestamptz default now()
);

-- ---- RLS: permissive for anon (single-user; hardened in Phase 2) ----
do $$
declare t text;
begin
  foreach t in array array[
    'todos','habits','habit_logs','goals','journal','movies','subjects',
    'timetable','announcements','investments','portfolio_snapshots',
    'health_metrics','workouts','news','briefs','builds','requests','memory'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "anon all" on %I', t);
    execute format('create policy "anon all" on %I for all using (true) with check (true)', t);
  end loop;
end $$;

-- Added 2026-08: see supabase/migrations/002-todos-time.sql for the migration
-- that brings an existing database up to this shape.
-- todos.due_time      time        wall-clock start; null means unscheduled
-- todos.duration_min  int         planned length
-- todos.actual_min    int         what it really took
-- todos.subtasks      jsonb       [{id, title, done}]
-- todos.repeat_rule   text        daily | weekdays | weekly | every:N
-- todos.repeat_until  date
-- todos.repeat_from   uuid        the task this was generated from
-- todos.sort_order    int         sparse manual ordering
