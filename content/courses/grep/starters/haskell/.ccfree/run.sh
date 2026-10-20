#!/bin/sh
#
# Runs your program. ccfree starts this for every test instance.

set -e

exec $(stack path --local-install-root)/bin/codecrafters-grep-exe "$@"