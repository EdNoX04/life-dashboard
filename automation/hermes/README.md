# Hermes — the contract

Hermes is not installed yet. This is everything the rest of the system has
already agreed to, so that when it is installed there is a contract to conform
to rather than a guess.

Nothing here needs Hermes to exist. `src/lib/hermes.js` (63 assertions) and
`automation/hermes/preflight.mjs` (53) both run today.

---

## What Hermes is

An agent on the always-on Omarchy laptop that picks up a build spec from the
Obsidian vault, works on it, and writes back what it did. It uses cloud models
through omniroute.online — **a different trust boundary from Anthropic's API**,
which is what the whole first half of this document is about.

## The one hard rule

> "make sure nothing secret goes on these cloud LLMs" — Neel

**Hermes reads `.md` files inside the vault. Nothing else. Ever.**

Not the life-dashboard repo, not `.env`, not `amizone.config.json`, not
`~/.ssh`, not the vault's own `.git/config` — which holds a push URL that can
carry a token.

This is an **allowlist**, and that is not a style choice. A list of what the
agent may *not* read has to be complete to work, and it never is: the next
secret is the one nobody thought to add. A list of what it *may* read is
complete by construction — one directory, one extension, everything else refused
by default, **including things that do not exist yet**. There is a test for
exactly that: a `creds.yaml` and an `id_rsa` dropped into the vault are refused
without anyone adding a rule for them.

### Run the preflight first, every time

```bash
node automation/hermes/preflight.mjs ~/brain
```

Exit 0 = safe to start. Exit 1 = **do not start**, and it names the file and
line.

It also carries a second net for the one thing an allowlist cannot catch: a
correctly-named `.md` note with a key pasted into it, which is exactly how a
secret gets into a vault — someone saves a snippet. It looks for Supabase keys,
JWTs, GitHub tokens, AWS keys, private keys, `.ASPXAUTH` cookies and
`password: …` assignments.

**It never prints what it found.** A guard that echoes the secret into a
terminal and a CI log has moved it somewhere new rather than stopped it. You get
the file, the line, and what kind of thing it was.

---

## The work loop

A spec is `projects/<slug>.md` in the vault, written by PLAYER TWO's
`queue_build` and confirmed by Neel. Its shape is fixed — **Status, Claimed,
then `## Why` / `## Steps` / `## Progress` / `## Retrospective`** — because
Hermes reads the file back, and *a heading it cannot find is a heading it
appends a second copy of*. Then the file has two Progress sections and the tab
renders the older one.

Every edit below is a pure function in `src/lib/hermes.js`. **Call them, or match
them exactly.** They are defined on the reading side on purpose: otherwise two
programs parse and write one format from opposite ends of a git repo, with no
shared tests and a push in between.

| step | function | the rule it enforces |
|---|---|---|
| find work | `nextForAgent(specs)` | oldest queued first, not newest |
| take it | `claim(body)` | refuses a spec another agent holds, unless that claim is over **6 h** old |
| record | `appendProgress(body, line)` | never creates a second `## Progress`; refuses a note that has none |
| tick | `tickStep(body, i)` | **by position, not by text** — matching text lets a reworded step tick the wrong box, and a wrongly ticked box is work that silently never happens |
| finish | `release(body, {status})` | clears the claim, sets `done` |
| give up | `release(body, {status:'blocked', reason})` | **the reason is required** — a stopped build that says nothing is the same as silence |

Then `git commit && git push` in the vault. `inbox.yml` and `index.yml` do the
rest; PLAYER ONE follows within a minute of the push.

### The lease is a line in a file

One agent, one laptop, a git repo in between. That is the entire concurrency
story, and it is deliberately this small — anything more would be machinery for
a race that cannot currently happen.

A claim goes stale after 6 hours so an agent that died does not hold a spec
forever. **That state is worse than queued**: nothing picks it up and nothing
complains. The Builds tab now says so out loud — *"has been building for 30h —
the agent stopped"*.

---

## What Hermes must never do

- **Touch money.** Money is READ-ONLY across this whole system. No trade, no
  transfer, no order, no write to `investments`. Not reachable from a spec, and
  not reachable from anything a spec can ask for.
- **Read outside the vault.** See above.
- **Write outside the vault.** Everything it produces is a change to a `.md`
  file. Supabase is reached only by the vault's own inbox runner, which has its
  own key and its own path rules.
- **Invent its own file format.** If a spec needs a new section, add it to
  `specNote()` in `buildspec.js` with a test, so both ends change together.
- **Push to `life-dashboard`.** `builds.js` already has `PROTECTED_REPOS`.
  Hermes pushes to the vault, and code it writes goes to its own new repo.

---

## Still to do when you install it

1. Clone the vault on Omarchy and run the preflight against it.
2. Point Hermes at `omniroute.online` with the model you want; keep the key in
   the environment, never in the repo, never in the vault.
3. Have it call the six functions above rather than editing markdown by hand.
4. Give it a heartbeat: write `{ok, at, reason}` into `memory.sync_status.hermes`
   at the end of a run, through the vault inbox or the same runner. The app's
   `sync` notification channel already watches every worker there, and
   `QUIET_AFTER_H` in `notify.js` wants an entry once its cadence is known.
5. Then delete this line and write down what the cadence actually turned out to
   be — the first few builds pay for every estimate after them.
