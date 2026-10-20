#!/bin/sh
#
# Runs your program. ccfree starts this for every test instance.

set -e

exec bun run "$(dirname "$0")/app/main.ts" "$@"