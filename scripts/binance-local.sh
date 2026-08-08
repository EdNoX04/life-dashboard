#!/usr/bin/env bash
# Run the Binance sync from THIS machine, not from GitHub Actions.
#
# Why it moved. Every request from a GitHub-hosted runner came back HTTP 451:
#
#   "Service unavailable from a restricted location according to 'b. Eligibility'"
#
# GitHub's runners are US-hosted and Binance.com refuses US IPs outright. That
# is not a bug in scripts/binance-sync.mjs — the script is fine and every request
# it makes is a GET — it is a property of where the job ran. It would have failed
# identically on every scheduled run forever, so the workflow was removed rather
# than left in the list as a permanently red entry that trains you to ignore red
# entries. Running from the MacBook puts the request on an Indian IP, which is
# the address the account is actually eligible from.
#
# Credentials live in scripts/.binance.env, which is gitignored. Create it
# yourself — it is never to be committed, and nothing in this repo will write it
# for you:
#
#   cd ~/Documents/Claude/Projects/life-dashboard
#   cat > scripts/.binance.env <<'EOF'
#   BINANCE_API_KEY=...
#   BINANCE_API_SECRET=...
#   SUPABASE_SERVICE_KEY=...
#   EOF
#   chmod 600 scripts/.binance.env
#
# The API key must be created with "Enable Reading" ONLY. Spot Trading and
# Withdrawals stay off. That is not caution about this script — every request in
# binance-sync.mjs is a GET and there is no code path that could place an order —
# it is so that a leaked key cannot move money regardless of what reads it.
#
# Schedule it twice a day with `crontab -e`:
#
#   0 9,21 * * *  /Users/neel/Documents/Claude/Projects/life-dashboard/scripts/binance-local.sh >> /tmp/binance-sync.log 2>&1
#
# A laptop is asleep sometimes and cron does not catch up on missed runs, so a
# run can be skipped. That is harmless here: the script re-reads a trailing
# window of history every time rather than only what is new, so a missed run is
# picked up by the next one.

set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$DIR/scripts/.binance.env"

if [ ! -f "$ENV_FILE" ]; then
  echo "No $ENV_FILE — create it with your Binance read-only key and Supabase service key (see the header of this file)." >&2
  exit 1
fi

# Refuse to run on a world-readable credentials file. A secret sitting at 644 in
# a synced Documents folder is a secret with a wider audience than intended.
PERM="$(stat -f '%A' "$ENV_FILE" 2>/dev/null || stat -c '%a' "$ENV_FILE")"
if [ "$PERM" != "600" ]; then
  echo "$ENV_FILE is mode $PERM — run: chmod 600 '$ENV_FILE'" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

export SUPABASE_URL="${SUPABASE_URL:-https://xroynvkzephebhcztvfo.supabase.co}"
export BINANCE_LOOKBACK_DAYS="${BINANCE_LOOKBACK_DAYS:-120}"

echo "--- binance sync $(date '+%Y-%m-%d %H:%M:%S %Z') ---"
cd "$DIR"
exec node scripts/binance-sync.mjs
