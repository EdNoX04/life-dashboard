-- 004 — require the second factor at the database.
--
-- RUN THIS ONLY AFTER YOU HAVE ENROLLED AND VERIFIED A TOTP FACTOR
-- (Settings → Security → Add authenticator, and successfully entered a code).
--
-- Tightening these policies against an account with no verified factor locks that
-- account out of its own data. The SQL editor runs as a superuser and is not
-- affected, so it is recoverable — re-run 003 to loosen it again — but it is an
-- unpleasant five minutes that is entirely avoidable by doing it in this order.
--
-- Why at the database rather than in the login screen: the login screen is a
-- React component, and anyone can skip it by calling PostgREST directly. A
-- password-only session is a real, valid session — without this migration it
-- reads every row. `aal2` in the JWT is the claim that says the second factor was
-- actually satisfied, and checking it here is the only place the check binds.

do $mfa$
declare
  t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public'
  loop
    execute format('drop policy if exists "authenticated full access" on public.%I', t);
    execute format('drop policy if exists "aal2 full access" on public.%I', t);
    execute format(
      'create policy "aal2 full access" on public.%I for all to authenticated '
      || 'using ((select auth.jwt()->>''aal'') = ''aal2'') '
      || 'with check ((select auth.jwt()->>''aal'') = ''aal2'')', t);
  end loop;
end
$mfa$;

-- Verify. Every row should say aal2 full access, and the qual column should
-- mention aal2 — a policy that exists but does not check anything is the failure
-- mode this whole file is guarding against.
-- select tablename, policyname, roles, qual from pg_policies
-- where schemaname = 'public' order by tablename;
