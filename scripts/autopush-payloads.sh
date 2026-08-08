#!/bin/bash
# Auto-push payloads — the last manual step in the sync path.
#
# The chain that lands INDmoney data in the dashboard is:
#
#   scheduled Claude task → reads the INDmoney MCP → writes payloads/*.json
#   into this repo → git push → GitHub Action runs apply-payloads.mjs → Supabase
#
# Every link is automatic except the push, because the push needs your GitHub
# credentials and nothing in that chain is allowed to hold them. This script is
# the join: run it on a schedule and the chain closes.
#
# It is deliberately narrow. It commits ONLY payloads/, so it can never sweep up
# half-finished source edits, and it does nothing at all when there is nothing
# new. If it cannot fast-forward it stops and says so rather than forcing.
#
# Install (optional — you can also just run it by hand):
#   chmod +x scripts/autopush-payloads.sh
#   crontab -e
#   0 10 * * 1-5 /Users/neel/Documents/Claude/Projects/life-dashboard/scripts/autopush-payloads.sh
#
# That is 10:00, half an hour after the sync task runs at 09:00 IST — enough
# margin for the task to have finished writing.

set -u
cd "$(dirname "$0")/.." || exit 1

log() { echo "[$(date '+%Y-%m-%d %H:%M')] $*"; }

# Nothing staged means nothing to do. Silence is correct here: a script that
# reports success every day trains you to stop reading it.
if [ -z "$(git status --porcelain payloads/)" ]; then
  exit 0
fi

log "payload changes found"

# Pull first. The remote moves on its own — the sync workers commit back — so a
# push without a rebase is the failure you have already hit twice.
if ! git pull --rebase --quiet origin main; then
  log "REBASE FAILED — stopping. Run 'git status' and resolve by hand; nothing was pushed."
  exit 1
fi

# Only payloads. A source file half-edited in your editor must never be swept
# into an automated commit.
git add payloads/
if git diff --cached --quiet; then
  log "nothing to commit after rebase"
  exit 0
fi

FILES=$(git diff --cached --name-only | sed 's|payloads/||' | tr '\n' ' ')
git commit --quiet -m "Payload sync: ${FILES}"

if git push --quiet origin main; then
  log "pushed: ${FILES}"
else
  log "PUSH FAILED — the commit is local and safe. Push by hand when you can."
  exit 1
fi
