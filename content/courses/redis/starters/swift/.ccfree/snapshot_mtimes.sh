#!/usr/bin/env bash
#
# Runs your program. ccfree starts this for every test instance.

set -euo pipefail

# Use a consistent locale and timezone to ensure consistent timestamp formatting.
export LC_ALL=C
export TZ=UTC

OUT="${1:-/tmp/codecrafters-mtimes.snapshot}"

ROOTS=(
  "/app"
  "/tmp/ccfree-build-redis-swift"
)

tmp_out="${OUT}.tmp"
# Truncate the output file at the start. This ensures we don't accidentally
# append to an old snapshot if something goes wrong during this script.
: > "$tmp_out"

extract_nsec_from_stat_y() {

  local stat_y="$1"
  local frac

  if [[ "$stat_y" =~ :[0-9]{2}\.([0-9]+)[[:space:]] ]]; then
    frac="${BASH_REMATCH[1]}"
  else
    frac="0"
  fi

  frac="${frac}000000000"
  printf '%s\n' "${frac:0:9}"
}

save_one_path() {
  local path="$1"
  local seconds
  local stat_y
  local nanoseconds

  seconds="$(stat -c '%Y' -- "$path")"
  stat_y="$(stat -c '%y' -- "$path")"
  nanoseconds="$(extract_nsec_from_stat_y "$stat_y")"

  printf '%s\0%s\0%s\0' "$path" "$seconds" "$nanoseconds" >> "$tmp_out"
}

for root in "${ROOTS[@]}"; do
  if [[ ! -e "$root" && ! -L "$root" ]]; then
    continue
  fi

  while IFS= read -r -d '' path; do
    save_one_path "$path"
  done < <(find -P "$root" -type d -name '.git*' -prune -o -print0)
done

mv "$tmp_out" "$OUT"

printf 'Created mtimes snapshot at %s\n' "$OUT"
