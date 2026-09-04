#!/bin/bash
# Import payload files the scheduled sync handed you, then push them.
#
# WHY THIS EXISTS
#
# The INDmoney sync runs in a scheduled cloud session, and from there every
# write path to this repo is shut: no device bridge, Supabase blocked, and the
# GitHub API answers "access to this repository is not enabled for this session".
# The only thing it can do is read INDmoney and hand you the payload files in
# chat. That part works.
#
# The join is where it broke. The task delivered two files and then printed:
#
#     git add payloads/holdings-mcp-2026-09-04.json payloads/sips-2026-09-04.json
#     git commit -m "…"
#     git push
#
# Run those without first saving the downloads into payloads/ and you get
# `fatal: pathspec … did not match any files`, then `nothing to commit`, then
# `Everything up-to-date` — three messages, none of which say the actual
# problem, and a dashboard that quietly stays stale. That is exactly what
# happened on 2026-09-04.
#
# So the manual step is now ONE command that cannot half-succeed. It finds the
# files wherever they were downloaded, checks they are the right shape before
# they go anywhere near a commit, moves them in, and pushes. When there is
# nothing to import it says so plainly instead of reporting success.
#
# Usage:
#   ./scripts/import-payloads.sh              # looks in ~/Downloads
#   ./scripts/import-payloads.sh ~/Desktop    # or wherever you saved them
#
# It is deliberately narrow: it only ever touches payloads/, so a half-edited
# source file cannot be swept into an automated commit.

set -u
cd "$(dirname "$0")/.." || exit 1

SRC="${1:-$HOME/Downloads}"
log() { echo "  $*"; }

echo "Importing payloads from: $SRC"

if [ ! -d "$SRC" ]; then
  echo "✗ $SRC is not a folder. Pass the folder you saved the files into:"
  echo "    ./scripts/import-payloads.sh ~/Desktop"
  exit 1
fi

# The payload families the scheduled tasks produce. Anything else in Downloads
# is none of this script's business.
PATTERNS=(
  'holdings-mcp-*.json'
  'sips-*.json'
  'dividends-received-*.json'
  'dividend-payments-*.json'
)

found=0
moved=()
skipped=()

for pat in "${PATTERNS[@]}"; do
  # A glob that matches nothing must not become a literal filename.
  shopt -s nullglob
  for f in "$SRC"/$pat; do
    found=$((found + 1))
    base=$(basename "$f")

    # Validate BEFORE moving. apply-payloads.mjs refuses a file with no `ops`
    # array — as it should — but it does that on GitHub's runner, minutes later,
    # in a log nobody reads. Catching it here means the bad file never enters a
    # commit, and you are told why while you can still do something about it.
    # NOTE: capture, then test. Piping python into `sed` and testing the result
    # tests SED's exit status, which is always 0 — so every invalid file would
    # pass validation and be committed. That bug was in the first version of
    # this script and its own test caught it; do not reintroduce the pipe.
    why=$(python3 -c "
import json,sys
try:
    d = json.load(open(sys.argv[1]))
except Exception as e:
    print('not valid JSON: %s' % e); sys.exit(1)
if not isinstance(d, dict) or not isinstance(d.get('ops'), list):
    print('no \"ops\" array — apply-payloads.mjs would refuse this'); sys.exit(1)
if not d['ops']:
    print('\"ops\" is empty — nothing would be written'); sys.exit(1)
sys.exit(0)
" "$f" 2>&1)
    if [ $? -ne 0 ]; then
      log "✗ $base — $why"
      skipped+=("$base")
      continue
    fi

    mv "$f" "payloads/$base" || { log "✗ could not move $base"; skipped+=("$base"); continue; }
    log "✓ $base"
    moved+=("$base")
  done
  shopt -u nullglob
done

if [ "$found" -eq 0 ]; then
  echo
  echo "Nothing to import — no payload files in $SRC."
  echo
  echo "The sync delivers them in the chat; download them first, then run this again."
  echo "Expected names: holdings-mcp-<date>.json, sips-<date>.json,"
  echo "                dividends-received-<date>.json, dividend-payments-<date>.json"
  exit 1
fi

if [ ${#moved[@]} -eq 0 ]; then
  echo
  echo "✗ Found $found file(s) but none were usable. Nothing was committed."
  exit 1
fi

# From here the existing push script owns it: pull --rebase, stage only
# payloads/, commit, push, and fail loudly rather than forcing.
echo
echo "Pushing…"
if [ -x scripts/autopush-payloads.sh ]; then
  scripts/autopush-payloads.sh
  rc=$?
else
  bash scripts/autopush-payloads.sh
  rc=$?
fi

if [ "$rc" -ne 0 ]; then
  echo "✗ Push step failed — the files are in payloads/ and safe. See the message above."
  exit "$rc"
fi

echo
echo "Done: ${#moved[@]} imported${skipped:+, ${#skipped[@]} skipped}."
echo "The apply-payloads Action will write them to Supabase within a minute or two."
echo "Check: https://github.com/EdNoX04/life-dashboard/actions"
