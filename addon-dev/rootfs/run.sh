#!/bin/sh
set -eu

# Dev add-on bootstrap (#607). Two jobs:
#
#   1. Render the nginx config template with the Supervisor-injected
#      bearer token. The token only exists inside the add-on container
#      at start time (Supervisor sets $SUPERVISOR_TOKEN per
#      `hassio_api: true`), so we can't bake it in.
#   2. exec nginx in the foreground as PID 1 — the add-on's liveness
#      keys on the server, like in production.
#
# If $SUPERVISOR_TOKEN isn't set (shouldn't happen with hassio_api: true
# in config.yaml, but cheap to guard), bail loudly rather than silently
# rendering an empty `Authorization: Bearer ` header that the Supervisor
# would 401 on — same failure mode we're trying to *escape* with this
# add-on, just less obvious.
if [ -z "${SUPERVISOR_TOKEN:-}" ]; then
  echo "[run.sh] FATAL: SUPERVISOR_TOKEN is not set. Check config.yaml has hassio_api: true." >&2
  exit 1
fi

echo "[run.sh] Rendering nginx config with Supervisor token..."
# Only substitute the one variable we know — the rest of the config has
# nginx-native `$variable` references (e.g. $remote_addr) that envsubst
# must not touch.
envsubst '${SUPERVISOR_TOKEN}' \
  < /etc/nginx/http.d/glaon-dev.conf.template \
  > /etc/nginx/http.d/glaon-dev.conf

echo "[run.sh] Starting nginx on :8099..."
exec nginx -g 'daemon off;'
