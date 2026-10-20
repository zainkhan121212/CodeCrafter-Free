#!/bin/sh
#
# Runs your program. ccfree starts this for every test instance.

set -e

exec /tmp/ccfree-build-http-server-rust/release/codecrafters-http-server "$@"
