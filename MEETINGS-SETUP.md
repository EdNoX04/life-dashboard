# Meetings — one-time setup

This makes the **webapp** create Google Calendar events + Google Meet links on its
own. You add a meeting in the dashboard → a GitHub Action (not this chat) picks it
up within ~5 min, creates the event with a Meet link, and the link appears on the
card. Nothing runs on your Mac after setup; nothing runs through Cowork chat.

## What you set up once

You need a Google OAuth token so the Action can write to your calendar. ~10 minutes.

### 1. Enable the API + make an OAuth client
1. Go to https://console.cloud.google.com/ → create/select any project.
2. **APIs & Services → Library** → search **Google Calendar API** → **Enable**.
3. **APIs & Services → OAuth consent screen** → **External** → fill the app name +
   your email → **Save**. On the **Test users** step, **add your own Gmail**
   (`ednox042004@gmail.com`). (No need to publish/verify — a test user is enough.)
4. **APIs & Services → Credentials → Create credentials → OAuth client ID** →
   Application type **Desktop app** → Create.
5. Copy the **Client ID** and **Client secret**.

### 2. Get a refresh token (on your Mac)
```bash
cd ~/Downloads/life-dashboard
export GOOGLE_CLIENT_ID=PASTE_CLIENT_ID
export GOOGLE_CLIENT_SECRET=PASTE_CLIENT_SECRET
node scripts/get-google-token.mjs
```
It opens a Google approval page (you may see "Google hasn't verified this app" →
Advanced → continue; that's expected for a personal test app). After you approve,
the terminal prints your **GOOGLE_REFRESH_TOKEN**.

### 3. Add the four GitHub secrets
Repo → **Settings → Secrets and variables → Actions → New repository secret**:

| Secret | Value |
|---|---|
| `GOOGLE_CLIENT_ID` | from step 1 |
| `GOOGLE_CLIENT_SECRET` | from step 1 |
| `GOOGLE_REFRESH_TOKEN` | printed in step 2 |
| `GOOGLE_CALENDAR_ID` | `primary` (or `ednox042004@gmail.com`) |

`SUPABASE_SERVICE_KEY` already exists from your other Actions.

### 4. Test it
Repo → **Actions → Meetings sync → Run workflow**. Then add a meeting in the app —
within ~5 min the card shows a Join Meet link. Or trigger the run manually right
after adding to see it immediately.

## Apple Calendar
There's no clean server API to push a Meet link into iCloud, and iCloud events
can't carry a Meet link anyway. The reliable way to see these in Apple Calendar:

- iPhone/Mac **Settings → Calendar → Accounts → Add Account → Google** → sign in
  with `ednox042004@gmail.com` → turn on Calendars.

Every event this worker creates then shows in the Apple Calendar app automatically,
Meet link and all — one account, no duplicates.

## Cost note
The Action polls every 5 min during waking hours. If the repo is **public**, Actions
minutes are free/unlimited. If **private**, this uses ~1,200 min/month (under the
2,000 free). To cut it, widen the cron interval in
`.github/workflows/meetings-sync.yml` (e.g. `*/10`).
