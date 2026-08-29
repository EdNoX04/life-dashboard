-- 006 — stop requiring the second factor at the database.
--
-- RUN THIS BEFORE DEPLOYING THE LOGIN SCREEN THAT NO LONGER ASKS FOR A CODE.
--
-- Order matters, and it is the exact reverse of 004. 004's policies admit only
-- a session whose JWT says aal2, which a password-only sign-in never reaches.
-- Deploy the new login first and every table returns zero rows to a perfectly
-- valid session — a dashboard that looks like the data was deleted, which is
-- the failure this project keeps trying not to ship. Run this first and the
-- old login still works throughout; the code prompt simply stops mattering.
--
-- What this does NOT do: open anything to `anon`. There is still no policy for
-- the anonymous role, so the publishable key in the bundle still reads nothing.
-- The boundary stays where 003 put it — signed in, or nothing. What changes is
-- that a password alone is once again enough, which is a real reduction: a
-- stolen password now reads every row instead of being useless without the
-- phone. That is the trade Neel asked for, knowingly.
--
-- To go back: re-enroll a factor in Settings → Security, verify it, then re-run
-- 004. In that order — 004 against an account with no verified factor locks it
-- out of its own data.

do $nomfa$
declare
  t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public'
  loop
    execute format('drop policy if exists "aal2 full access" on public.%I', t);
    execute format('drop policy if exists "authenticated full access" on public.%I', t);
    execute format(
      'create policy "authenticated full access" on public.%I for all to authenticated '
      || 'using (true) with check (true)', t);
  end loop;
end
$nomfa$;

-- Verify. Every public table should have exactly one policy, named
-- "authenticated full access", with roles {authenticated} — and NOTHING should
-- list {anon}. A table that lost its policy entirely reads as empty, which looks
-- identical to data loss, so check the count matches your table count.
-- select tablename, policyname, roles, qual from pg_policies
-- where schemaname = 'public' order by tablename;
