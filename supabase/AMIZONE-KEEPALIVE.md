# Amizone keepalive — cloud, no laptop

**The problem:** the Amizone ticket dies in roughly fifteen minutes. Everything
that could keep it alive needed a machine that was awake — the Mac, Chrome, the
Omarchy laptop — and GitHub's cron is routinely 10–20 minutes late, which is
useless against a fifteen-minute window.

**This runs in Supabase.** pg_cron fires on time, Postgres is already up, and the
whole job is one small fetch. It is the only option that works at 3am with every
device shut.

**It never logs in.** No username, no password, it never touches the login form —
so Cloudflare Turnstile is never involved, which is what killed every previous
cloud attempt. It carries a ticket a human already created and hands back
whatever the server reissues. When the ticket finally does die, it cannot revive
it — it says so in `sync_status`, and the dashboard's `sync` notification turns
that into something you actually see.

## Setup

**1. Pick a shared secret.** Any long random string. It stops the endpoint being
an open proxy that anyone could use to burn your session.

```bash
openssl rand -hex 32
```

**2. Give the function its environment.** Supabase dashboard → Edge Functions →
Secrets (or `supabase secrets set`):

| Name | Value |
|---|---|
| `KEEPALIVE_SECRET` | the string from step 1 |

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically — you
do not set those.

**3. Deploy, without JWT verification.** pg_cron cannot mint a user JWT, so the
function checks its own secret instead:

```bash
supabase functions deploy amizone-keepalive --no-verify-jwt
```

**4. Test it by hand before scheduling anything:**

```bash
curl -s -X POST 'https://xroynvkzephebhcztvfo.supabase.co/functions/v1/amizone-keepalive' \
  -H "x-keepalive-secret: $KEEPALIVE_SECRET"
```

Expect `{"ok":true,...}` if the session is alive, or `{"ok":false,"reason":"expired","lifetime":"..."}`
if it is not — and that `lifetime` string is the measurement this whole exercise
has been missing.

**5. Schedule it.** Supabase dashboard → SQL Editor. **Do not commit this with
the real values filled in** — run it there, not from a file in the repo.

```sql
create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net  with schema extensions;

select cron.schedule(
  'amizone-keepalive',
  '*/5 * * * *',                       -- every 5 minutes; see "How often" below
  $$
  select net.http_post(
    url     := 'https://xroynvkzephebhcztvfo.supabase.co/functions/v1/amizone-keepalive',
    headers := '{"Content-Type":"application/json","x-keepalive-secret":"PUT_THE_SECRET_HERE"}'::jsonb,
    body    := '{}'::jsonb
  );
  $$
);
```

Check it is registered, and watch it run:

```sql
select jobid, schedule, jobname, active from cron.job;
select * from cron.job_run_details order by start_time desc limit 10;
```

To change the interval later: `select cron.unschedule('amizone-keepalive');` then
re-run the `cron.schedule` above with a new expression.

## How often

Start at **every 5 minutes** — comfortably inside a fifteen-minute window, and
288 tiny invocations a day, which is nothing against Supabase's free allowance.

Once it has been running a day, the numbers tell you whether to relax it:

```sql
select value from memory where key = 'sync_status';
```

Look at `amizone_keepalive.renewed`. **The first time that is `true`, sliding
expiration has fired for the first time in this project's history** — the ticket
is now renewing itself and the session can outlive its nominal timeout
indefinitely.

## What it cannot do

**It cannot survive a real expiry.** If the session dies — Amizone forces a
re-login, or you log in somewhere else and it invalidates this one — the
keepalive reports it and stops. You re-paste once from Settings and it carries on.
The aim is to turn "every morning" into "rarely".

**Watch for a session fight.** If Amizone enforces one session per user, your own
browser login and this stored ticket will kill each other, and you will see
`expired` immediately after every time you use Amizone yourself. If the
`lifetime` line consistently reads like minutes rather than hours *and* the
timing lines up with when you were logged in on your phone or laptop, that is
what is happening — and the fix is different from a timeout (the keepalive would
have to stand down while you are using it, or lose).

The instrumentation now says which of the two it is. Until now nothing did.
