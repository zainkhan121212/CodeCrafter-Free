#!/bin/sh
#
# Runs your program. ccfree starts this for every test instance.

set -e

stackInstallRoot=$(cd $(dirname "$0") && stack path --local-install-root)
exec "$stackInstallRoot/bin/codecrafters-http-server-exe" "$@"