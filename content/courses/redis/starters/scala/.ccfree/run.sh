#!/bin/sh
#
# Runs your program. ccfree starts this for every test instance.

set -e

exec java -jar /tmp/ccfree-build-redis-scala "$@"
