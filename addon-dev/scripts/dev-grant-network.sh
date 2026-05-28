#!/usr/bin/env bash
# Disable HA Protection mode for the Glaon dev add-on (#624).
#
# The add-on declares `hassio_role: admin` so it can reach the Supervisor
# network endpoints (`/network/interface/{iface}/accesspoints` + /update).
# But while HA's per-install **Protection mode** is ON (the default), the
# Supervisor caps the add-on at the base role regardless of the requested
# role — so `/network/info` works but the scan/update return 403.
#
# Protection mode is NOT an add-on option — an add-on cannot lift its own
# sandbox from config.yaml (by HA's security design). It's a per-install
# user/API action. The Supervisor toggle is
# `POST /addons/{slug}/security` with `{"protected": false}` (the key is
# `protected`, NOT `protection`).
#
# IMPORTANT — token needs ADMIN. Setting another add-on's protection
# requires an admin-role caller. A normal terminal add-on's
# $SUPERVISOR_TOKEN is `manager` at best → this script will 403. Two
# reliable paths:
#
#   1. Run this script in a terminal add-on that HAS admin + its own
#      protection OFF. If you get 403, your terminal isn't admin — use
#      path 2.
#   2. Browser console (your logged-in HA admin session), no script:
#        const hass = document.querySelector('home-assistant').hass;
#        await hass.callWS({ type: 'supervisor/api',
#          endpoint: '/addons/local_glaon_dev/security',
#          method: 'post', data: { protected: false } });
#      This is what the (often-missing) UI toggle does internally and is
#      the most dependable route. See docs/dev-addon-pi.md §4.5.
#
#   bash /addons/local/glaon_dev/scripts/dev-grant-network.sh
#
# Idempotent: re-running on an already-unprotected add-on is a no-op.
set -euo pipefail

SLUG="local_glaon_dev"
SUPERVISOR="http://supervisor"

if [ -z "${SUPERVISOR_TOKEN:-}" ]; then
  echo "FATAL: \$SUPERVISOR_TOKEN is not set." >&2
  echo "Run this inside the HA Terminal / SSH add-on, not a host shell." >&2
  exit 1
fi

auth=(-H "Authorization: Bearer ${SUPERVISOR_TOKEN}")

echo "==> Disabling Protection mode for ${SLUG}..."
curl -fsS -X POST "${auth[@]}" \
  -H "Content-Type: application/json" \
  -d '{"protected": false}' \
  "${SUPERVISOR}/addons/${SLUG}/security"
echo

echo "==> Restarting ${SLUG}..."
curl -fsS -X POST "${auth[@]}" "${SUPERVISOR}/addons/${SLUG}/restart"
echo

echo "==> Current protection state:"
# `info` returns { data: { protected: bool, ... } }; print just that.
curl -fsS "${auth[@]}" "${SUPERVISOR}/addons/${SLUG}/info" \
  | sed -n 's/.*"protected":\s*\(true\|false\).*/protected: \1/p' \
  | head -n1

echo "Done. Expect 'protected: false'. The /network/* scan + update endpoints should now answer 200."
