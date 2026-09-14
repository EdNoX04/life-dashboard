# PLAYER ONE — iOS

Native SwiftUI app for the Life HQ dashboard. Same Supabase project as the web
app, same tables, same auth. Not a webview wrapper: HealthKit, WidgetKit and
offline task capture are the reasons the iOS version exists at all, and none of
the three survives being wrapped.

Status: **scaffolding started in a cloud container, handed to a local Mac
session.** Only `Core/Config.swift` is written. Everything below is the plan
that session should pick up.

## Why native

| Want | Wrapper gives you | Native gives you |
|---|---|---|
| Apple Health | a third-party bridge app (Health Auto Export) posting to an edge function | HealthKit read + background delivery, no middleman |
| Widgets | none | WidgetKit, Lock Screen, interactive tick-off |
| Add a task with no signal | fails | local write, queued, synced |

The existing `supabase/functions/health-ingest` stays deployed and keeps
working. The iOS app writes the **same metric keys** to the same tables so the
two paths are interchangeable and neither double-counts (both delete-then-insert
per `date`+`metric`).

## Targets

- Deployment target **iOS 26.0**, Swift 6, Xcode 27.
- `PlayerOne` (app) + `PlayerOneWidgets` (widget extension).
- App Group `group.com.neel.playerone` — the snapshot the widgets read.
- Keychain sharing — so a widget's interactive intent can write to Supabase
  without a second login.
- Capabilities: HealthKit, App Groups, Keychain Sharing, Background Modes
  (fetch + processing).

## Backend contract (already live, do not re-invent)

Read `src/lib/db.js` and `src/lib/auth.js` first — the iOS layer is a port of
those two files and must not drift from them.

- **Base**: `https://xroynvkzephebhcztvfo.supabase.co`
- **Publishable key** ships in the client on purpose. Since
  `supabase/migrations/003-rls-lock.sql` it routes and does not authorise: RLS
  admits `authenticated` only, there is no `anon` policy, and a table with RLS
  on and no matching policy returns **zero rows rather than an error**. Worth
  knowing when testing — an empty array is the locked-out case, not an empty
  database.
- **Auth**: plain GoTrue REST, no SDK.
  - `POST /auth/v1/token?grant_type=password`
  - `POST /auth/v1/token?grant_type=refresh_token`
  - `POST /auth/v1/logout`
  - `GET /auth/v1/user` — factors live here; there is no `GET /factors`.
  - `POST /auth/v1/factors`, `/factors/{id}/challenge`, `/factors/{id}/verify`
  - Google: `GET /auth/v1/authorize?provider=google&redirect_to=playerone://auth-callback`
    via `ASWebAuthenticationSession`. No Google SDK, no plist. The redirect URL
    must be added in Supabase → Authentication → URL Configuration.
- **Single-flight refresh is not optional.** Supabase rotates the refresh token
  on use. Eight parallel loads firing eight refreshes means seven race a token
  that has already been replaced and the session dies on launch — which reads
  as "it logs me out at random". `auth.js` solves this with one shared
  in-flight promise; the Swift port needs the actor equivalent.
- **MFA**: migration 006 dropped the database-level aal2 requirement, so a
  password alone works today. The app should still handle a verified factor
  (`sessionAal()` reading `aal` out of the JWT) because re-running 004 is a
  documented path back.
- **Data**: PostgREST. `Prefer: return=representation`. Default order
  `created_at.desc`, **except `memory`, which has no `created_at`** and must be
  ordered by `key` or PostgREST 400s the whole query. Page past the 1000-row cap
  with `Range` headers for health history.
- **IDs are client-generated.** `db.js` sends `id` and `created_at` on insert.
  Keep that: it is what lets a task created in aeroplane mode keep its identity
  when it finally syncs.

## Tables in play for phase 1

`todos` (+ migration 002: `due_time`, `duration_min`, `actual_min`, `subtasks`,
`repeat_rule`, `repeat_until`, `repeat_from`, `sort_order`), `habits`,
`habit_logs`, `goals`, `journal`, `health_metrics`, `workouts`, `memory`,
`requests`.

Health metric keys the edge function already writes, which iOS must match
exactly: `steps`, `heart_rate`, `resting_hr`, `hrv`, `walking_hr`,
`active_energy`, `exercise_min`, `sleep_hours`, `resp_rate`, `spo2`, `vo2max`,
`weight`, `distance_km`. `source` = `apple_health`.

## Build order (as asked)

1. **Auth** — email/password + Google, Keychain session, TOTP if enrolled.
2. **Dashboard** — HQ: up next, today's todos, habit rings, health tiles.
3. **Then the rest** — Todos offline-first, HealthKit sync, widgets.

## Design system

Port `src/theme.css` tokens to Swift. All 11 palettes (`grape` default, amber,
matrix, ice, synth, retro70, vintage, spring, summer, autumn, winter) — the
choice syncs through `memory.app_config.theme`, so the phone must honour it or
the two clients will visibly disagree.

Pixel type: the web uses 'Press Start 2P' (headings) and 'VT323' (body). Ship
both as bundled TTFs rather than relying on a system face.

## Project generation

`project.yml` (XcodeGen) is the source of truth; the generated
`PlayerOne.xcodeproj` is committed so the project opens without installing
anything. Regenerate with `xcodegen generate` after touching the spec.
