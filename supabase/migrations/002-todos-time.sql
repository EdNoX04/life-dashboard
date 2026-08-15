-- Todos: time, duration, subtasks, repeat, and actual time logged.
--
-- Run this once in the Supabase SQL editor. Every column is added with a
-- default that means "as before", so existing rows keep working untouched and
-- nothing has to be backfilled.
--
-- WHY due_time IS NULLABLE AND STAYS THAT WAY
-- A task with no time is not a task at midnight. Most tasks never get one, and
-- defaulting them to 00:00 would put the whole list on the calendar at the top
-- of the day — which is worse than not drawing them, because it looks like a
-- schedule you chose.

alter table todos add column if not exists due_time      time;
alter table todos add column if not exists duration_min  int;
alter table todos add column if not exists actual_min    int;
alter table todos add column if not exists subtasks      jsonb default '[]'::jsonb;
alter table todos add column if not exists repeat_rule   text;
alter table todos add column if not exists repeat_until  date;
-- Which task this one was generated from, so a repeating series can be traced
-- back and the history of what was actually done is never overwritten.
alter table todos add column if not exists repeat_from   uuid;
-- Free ordering within a list, for drag-to-reorder. Sparse on purpose: gaps of
-- 1000 mean a reorder usually writes one row instead of renumbering the list.
alter table todos add column if not exists sort_order    int;

create index if not exists todos_due_idx on todos (due_date, due_time);
create index if not exists todos_open_idx on todos (completed, due_date);
