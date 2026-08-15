-- Paste this after 003 has run. Three checks, in order of what they prove.

-- 1. RLS is on for every table, and nothing was missed.
select tablename, rowsecurity as rls_on
from pg_tables where schemaname = 'public'
order by rowsecurity, tablename;

-- 2. Exactly one policy per table, granted to `authenticated` only.
--    Any row here showing {anon} or {public} is a door still open.
select tablename, policyname, roles, cmd
from pg_policies where schemaname = 'public'
order by tablename;

-- 3. Who exists to log in as. Should be exactly one row — you.
select email, created_at, last_sign_in_at
from auth.users order by created_at;
