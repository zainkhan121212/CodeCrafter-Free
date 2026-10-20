#!/bin/sh
#
# Compiles your program. ccfree runs this once before the tests start.

set -e

dotnet build --configuration Release --output /tmp/ccfree-build-dns-server-csharp codecrafters-dns-server.csproj
