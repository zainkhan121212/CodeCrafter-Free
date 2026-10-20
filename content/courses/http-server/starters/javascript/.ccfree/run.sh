#!/bin/sh
#
# Runs your program. ccfree starts this for every test instance.

set -e

NODE_PATH="$(dirname "$0")/node_modules" \
exec node "$(dirname "$0")/app/main.js" "$@"