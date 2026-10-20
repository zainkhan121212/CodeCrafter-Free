#!/bin/sh
#
# Runs your program. ccfree starts this for every test instance.

set -e

exec swift run -c release --skip-build swift-sqlite-challenge "$@"
