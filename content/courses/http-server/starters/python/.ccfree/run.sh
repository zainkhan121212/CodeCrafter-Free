#!/bin/sh
#
# Runs your program. ccfree starts this for every test instance.

set -e

exec uv run --quiet -m app.main "$@"