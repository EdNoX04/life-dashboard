# The overnight factory — setup

Four steps, all on the MacBook. Nothing here runs on GitHub Actions: the Free plan
gives 2,000 minutes a month for private repos and a nightly four-hour run is 240 of
them, so a full month would cost about $31.

## 1. The env file

    cd ~/Projects/life-dashboard
    cat > scripts/.build.env <<'EOF'
    SUPABASE_URL=https://xroynvkzephebhcztvfo.supabase.co
    SUPABASE_SERVICE_KEY=<the service_role key from Supabase → Settings → API>
    NVIDIA_API_KEY=<your nvapi- key>
    EOF
    chmod 600 scripts/.build.env

This is the one place a credential lives, it is gitignored, and it is readable only
by you. The runner sources it; the plist does not contain it, because a plist is
indexed by Spotlight and backed up by Time Machine.

**Confirm it is ignored before you go anywhere near a commit:**

    git check-ignore -v scripts/.build.env

If that prints nothing, add `scripts/.build.env` to `.gitignore` first.

## 2. GitHub

    gh auth status

The runner shells out to `gh` and stores no token of its own, so there is nothing
in this project to leak. If that command complains, run `gh auth login` once.

## 3. Install the job

    cp automation/com.playerone.builds.plist ~/Library/LaunchAgents/
    launchctl load ~/Library/LaunchAgents/com.playerone.builds.plist

## 4. Make the Mac awake at 2am

    sudo pmset repeat wakeorpoweron MTWRFSU 01:55:00

A launchd job on a sleeping machine does not run — it queues. And a queued 02:00
job firing at 09:00 exits immediately, because the runner checks the window before
every phase. So without this you would get a factory that never once ran and never
once said why.

The lid can be closed. It cannot be shut down, and it should be plugged in.

## Trying it before tonight

The window check is the only thing stopping a daytime run, so override it:

    set -a; . scripts/.build.env; set +a
    node -e "
      const b = require('fs').readFileSync('src/lib/builds.js','utf8');
    " # (sanity only)
    # Real dry run: temporarily widen the window in src/lib/builds.js WINDOW,
    # queue one small idea in the Builds tab, and run:
    node scripts/build-runner.mjs

Put the window back to 2–6 afterwards. Watch it with:

    tail -f ~/Library/Logs/playerone-builds.log

## What to expect in the morning

The Builds tab shows the phase, the requests spent out of 600, and a link to a
private repo. A build that shipped with known test failures says so rather than
showing the same green tick as a clean one.

Nights two onward: leave a note on the build ("add login", "the layout is cramped")
and that becomes the next night's brief. Nothing happens to a finished build with
no notes on it — regenerating an untouched repo would burn budget and churn the
diff for nobody.
