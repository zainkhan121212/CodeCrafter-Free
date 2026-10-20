#!/bin/sh
#
# Runs your program. ccfree starts this for every test instance.

set -e

exec /tmp/ccfree-build-csharp/CodeCrafters.ClaudeCode "$@"
