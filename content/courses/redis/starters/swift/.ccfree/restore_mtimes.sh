#!/usr/bin/env bash
#
# Runs your program. ccfree starts this for every test instance.

set -euo pipefail

# Use a consistent locale and timezone to ensure consistent timestamp formatting.
export LC_ALL=C
export TZ=UTC

IN="${1:-/tmp/codecrafters-mtimes.snapshot}"

if [[ ! -f "$IN" ]]; then
  echo "Skipping restore: snapshot file not found: $IN" >&2
  exit 1
fi

SECONDS=0

# The number of files whose mtimes were successfully restored.
restored=0
# The number of files that were missing.
missing=0
# The number of files that failed to restore for some reason (e.g. permissions).
failed=0

# The format is intentionally kept simple for easy parsing.
# Each record is:
#   path NUL seconds NUL nanoseconds NUL
# where the timestamp is split into seconds and nanoseconds, to avoid issues
# with floating point precision and locale-specific decimal separators.
while \
  IFS= read -r -d '' path && \
  IFS= read -r -d '' mtime_seconds && \
  IFS= read -r -d '' mtime_nanoseconds
do
  if [[ ! -e "$path" && ! -L "$path" ]]; then
    missing=$((missing + 1))
    continue
  fi

  timestamp="@${mtime_seconds}.${mtime_nanoseconds}"

  if touch -h -m -d "$timestamp" -- "$path"; then
    restored=$((restored + 1))
  else
    failed=$((failed + 1))
  fi
done < "$IN"

elapsed="$SECONDS"

printf 'Restored mtimes: restored=%s missing=%s failed=%s time_taken=%ss\n' \
  "$restored" "$missing" "$failed" "$elapsed"

if [[ "$failed" -ne 0 ]]; then
  exit 1
fi
