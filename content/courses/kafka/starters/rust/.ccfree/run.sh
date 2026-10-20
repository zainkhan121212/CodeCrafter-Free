#!/bin/sh
#
# Runs your program. ccfree starts this for every test instance.

set -e

exec /tmp/ccfree-build-kafka-rust/release/codecrafters-kafka "$@"
