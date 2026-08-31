-- 009 — a table for focus sessions.
--
-- The pomodoro timer counted rounds and forgot them. "🍅 4 focus rounds" is a
-- number that resets, means nothing tomorrow, and cannot answer the one question
-- worth asking: where did the time actually go?
--
-- So every completed block is recorded, with what it was for. Two ways of
-- naming that:
--
--   * `todo_id` — the block was spent on a specific task, and the task's own
--     `actual_min` is incremented too, so the todo list gains a real record of
--     effort rather than an estimate.
--   * `label` — free text, for work that is not a todo ("revise Module 2",
--     "read the Corda whitepaper"). Always populated, including when a todo is
--     linked, so history stays readable even after a task is deleted.
--
-- Only COMPLETED blocks land here. A session abandoned halfway is not time you
-- spent focusing, and counting it would make the history flattering and useless.
-- Breaks are recorded too but marked as such, because "how much did I actually
-- rest" is a fair question and separating them costs one column.
--
-- Run this BEFORE deploying the new Study tab. It only adds; nothing existing
-- reads or writes this table.

create table if not exists public.focus_sessions (
  id          uuid primary key default gen_random_uuid(),

  -- 'focus' | 'short' | 'long'. Kept as text rather than an enum so a future
  -- mode does not need a migration to be recordable.
  mode        text        not null default 'focus',

  -- What the block was for. Never null: when a todo is linked this holds a copy
  -- of its title at the time, so deleting the task does not erase the history.
  label       text        not null default 'Focus',

  -- The task this was spent on, if any. ON DELETE SET NULL rather than CASCADE:
  -- deleting a todo must not delete the record that you worked on it.
  todo_id     uuid        references public.todos(id) on delete set null,

  -- Wall-clock span. `minutes` is stored rather than derived because the
  -- configured length is the honest answer to "how long was this block", and
  -- deriving it from timestamps would drift with clock changes and DST.
  started_at  timestamptz not null default now(),
  ended_at    timestamptz not null default now(),
  minutes     int         not null default 25,

  created_at  timestamptz not null default now()
);

-- The two questions the history answers: "what did I do recently" and
-- "how much time has this task had in total".
create index if not exists focus_sessions_ended_idx on public.focus_sessions (ended_at desc);
create index if not exists focus_sessions_todo_idx  on public.focus_sessions (todo_id);

-- RLS, same shape as every other table here.
--
-- NOTE, because migration 006 was written the other way round and it matters:
-- a NEWLY created table starts with RLS enabled and no policy, which denies
-- everything including the owner. Looping over existing tables would skip this
-- one. So the policy is written out explicitly.
alter table public.focus_sessions enable row level security;

drop policy if exists "authenticated full access" on public.focus_sessions;
create policy "authenticated full access"
  on public.focus_sessions
  for all
  to authenticated
  using (true)
  with check (true);
