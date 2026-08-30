-- 008 — the queue that lets the app write into the Obsidian vault.
--
-- The vault is a private git repo, and a browser cannot push to one: there is no
-- token in the bundle and there should not be. So everything the app produces
-- that belongs in the vault — lecture notes, captures from the WhatsApp bot,
-- anything PLAYER TWO writes — lands here first, and a scheduled Action in the
-- `brain` repo turns rows into files and commits them.
--
-- One table rather than a memory blob because these are QUEUE items: many small
-- rows with a lifecycle, written by one side and consumed by the other. A blob
-- would make two writers race over one value.

create table if not exists public.vault_inbox (
  id           uuid primary key default gen_random_uuid(),
  -- Where it goes, relative to the vault root: 'college/lectures/2026-08-30-iot.md'.
  -- Validated again by the runner before anything is written; this column is a
  -- request, not an instruction.
  path         text not null,
  title        text,
  body         text not null,
  -- Who asked. Useful when a run goes wrong and the question is which feature
  -- produced the bad row.
  source       text not null default 'app',
  -- pending → committed, or → rejected with a reason. Rows are kept after
  -- committing rather than deleted: a note that vanished from the vault and left
  -- nothing behind is unanswerable.
  status       text not null default 'pending',
  reason       text,
  commit_sha   text,
  created_at   timestamptz not null default now(),
  handled_at   timestamptz
);

create index if not exists vault_inbox_pending_idx
  on public.vault_inbox (created_at) where status = 'pending';

alter table public.vault_inbox enable row level security;
drop policy if exists "authenticated full access" on public.vault_inbox;
create policy "authenticated full access" on public.vault_inbox
  for all to authenticated using (true) with check (true);

-- Verify: one row, roles {authenticated}, nothing for anon.
-- select tablename, policyname, roles from pg_policies
-- where schemaname = 'public' and tablename = 'vault_inbox';
