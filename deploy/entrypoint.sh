#!/bin/sh
set -eu
if [ ! -f "${CLIENT_DIR}/index.html" ]; then
	node scripts/capture.mjs
fi
exec node src/server.mjs
