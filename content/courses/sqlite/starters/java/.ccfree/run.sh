#!/bin/sh
#
# Runs your program. ccfree starts this for every test instance.

set -e

exec java --enable-preview -jar /tmp/ccfree-build-sqlite-java/codecrafters-sqlite.jar "$@"
