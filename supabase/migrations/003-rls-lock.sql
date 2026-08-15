-- 003 — close the doors.
--
-- Until now every table in this project was readable, writable and DELETABLE by
-- anyone who opened the dashboard URL. Not theoretically: the publishable key is
-- compiled into the JS bundle, and a fetch from any browser tab returned
-- memory.app_config in full — including every API key the Settings screen syncs.
--
-- Enabling RLS with an authenticated-only policy makes the publishable key inert
-- on its own. It stops being a credential and becomes what it was always meant to
-- be: a routing token that says which project you are talking to. Actual access
-- now requires a session token from a real login.
--
-- THIS DOES NOT BREAK THE GITHUB ACTIONS WORKERS. They authenticate with
-- SUPABASE_SERVICE_KEY, and the service role bypasses RLS by design. meeting-worker,
-- prices-sync, amizone-sync, letterboxd-sync and apply-payloads all keep working
-- untouched. The only clients that lose access are anonymous browsers, which is
-- the entire point.
--
-- Run this once in the Supabase SQL editor, AFTER you have created your user in
-- Authentication → Users. Running it before means locking yourself out until the
-- user exists — recoverable (the SQL editor runs as a superuser and is unaffected)
-- but confusing.

-- Every table in public, including any added later that I do not know about.
-- Written as a loop rather than a list precisely because a hand-written list is
-- how one table gets forgotten and quietly stays open.
do $mig$
declare
  t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public'
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "authenticated full access" on public.%I', t);
    execute format(
      'create policy "authenticated full access" on public.%I '
      'for all to authenticated using (true) with check (true)', t);
  end loop;
end
$mig$;

-- No policy is granted to `anon`, and a table with RLS on and no matching policy
-- returns zero rows rather than an error. So an anonymous request does not fail
-- loudly — it succeeds and finds nothing. Worth knowing when you test it: an
-- empty array is the success case, not a sign the check did not run.

-- ---------------------------------------------------------------------------
-- Enabling RLS was not enough, and the verify query is what caught it.
--
-- Every one of the 18 tables already carried a policy named "anon all" granted
-- to {public}. Postgres policies are PERMISSIVE by default and combine with OR:
-- if any policy matches, access is granted. So "anon all" kept granting
-- everything to everyone — including anonymous — while RLS sat switched on and
-- the new authenticated policy sat beside it doing nothing. A lock fitted next
-- to an open door.
--
-- {public} is also broader than {anon}: it means every role there is.
--
-- Dropping by "not my policy" rather than by the name "anon all", for the same
-- reason the block above loops over pg_tables: a straggler must not survive
-- merely by being absent from a list I wrote.
do $drop$
declare r record;
begin
  for r in
    select tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and policyname <> 'authenticated full access'
  loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end
$drop$;
