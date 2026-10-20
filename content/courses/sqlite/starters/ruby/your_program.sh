#!/bin/sh
#
# Runs your program locally: compiles it (if needed), then executes it with the given arguments.

set -e

export BUNDLE_GEMFILE="$(dirname "$0")/Gemfile"
exec bundle exec ruby "$(dirname "$0")/app/main.rb" "$@"
