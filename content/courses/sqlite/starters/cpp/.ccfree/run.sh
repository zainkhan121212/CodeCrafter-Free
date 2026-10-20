#!/bin/sh
#
# Runs your program. ccfree starts this for every test instance.

set -e

exec $(dirname "$0")/build/sqlite "$@"