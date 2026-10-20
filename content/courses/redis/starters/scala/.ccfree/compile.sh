#!/bin/sh
#
# Compiles your program. ccfree runs this once before the tests start.

set -e

scala-cli package src/main/scala/ \
  -q --power --assembly --force --server=false --scala-version=3.9.0 \
  --main-class codecrafters_redis.Server \
  -o /tmp/ccfree-build-redis-scala