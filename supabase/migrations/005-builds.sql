-- 005 — the builds table learns what an overnight run needs to remember.
--
-- Run in the Supabase SQL editor. Every column is nullable or defaulted, so the
-- rows already in `builds` keep working untouched.
--
-- The shape is driven by one requirement: a run must be RESUMABLE. It happens on
-- a laptop between 02:00 and 06:00, and the lid can close, the wifi can drop, or
-- the window can simply end mid-file. A build that cannot say where it got to is
-- a build that starts over every night and never finishes anything.

alter table builds add column if not exists brief          text;
alter table builds add column if not exists manifest       jsonb;
alter table builds add column if not exists phase          text default 'brief';
alter table builds add column if not exists iteration      int  default 0;
-- Notes are the whole point of the thing: a build is not finished when it ships,
-- it is finished when Neel stops asking for more. Each night reads the notes left
-- since the last run and treats them as that night's brief.
alter table builds add column if not exists notes          jsonb default '[]'::jsonb;
-- Written by the runner at the moment it creates the repo. This — not the name —
-- is what authorises a later push: a name can be typed, guessed or collided with;
-- a URL we recorded after creating it cannot be.
alter table builds add column if not exists repo_url       text;
alter table builds add column if not exists requests_used  int  default 0;
alter table builds add column if not exists verify_failures int default 0;
alter table builds add column if not exists fail_reason    text;
alter table builds add column if not exists log            jsonb default '[]'::jsonb;
alter table builds add column if not exists last_run       timestamptz;

create index if not exists builds_status_idx on builds (status, created_at);

-- RLS: 003 loops over every table in public, so this table already carries the
-- authenticated-only policy and nothing further is needed here. Noted because the
-- absence of a policy line in a migration that adds columns looks like an
-- oversight otherwise.
