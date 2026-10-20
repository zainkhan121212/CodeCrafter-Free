#!/bin/sh
#
# Runs your program. ccfree starts this for every test instance.

set -e

export BUNDLE_GEMFILE="$(dirname "$0")/Gemfile"
exec bundle exec ruby "$(dirname "$0")/app/main.rb" "$@"
