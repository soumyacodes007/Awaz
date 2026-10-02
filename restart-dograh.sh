#!/usr/bin/env bash
# Bring Dograh back up after a `wsl --shutdown`, then verify the stack.
#
#   ./restart-dograh.sh
#
# Mirrored networking (see C:\Users\soumy\.wslconfig) means WSL shares the
# Windows network stack, so WebRTC no longer needs a TURN relay to reach the
# browser. Coturn stays configured but is not forced.
set -euo pipefail

cd "$(dirname "$0")"

export REGISTRY="${REGISTRY:-ghcr.io/dograh-hq}"
export ENABLE_TELEMETRY="${ENABLE_TELEMETRY:-false}"

echo "==> starting containers"
docker compose up -d

echo "==> waiting for API"
for _ in $(seq 1 45); do
    if curl -sf -o /dev/null http://localhost:8000/api/v1/health; then break; fi
    sleep 2
done

echo "==> waiting for UI"
for _ in $(seq 1 45); do
    if curl -sf -o /dev/null http://localhost:3010; then break; fi
    sleep 2
done

echo
echo "==> status"
docker compose ps --format '{{.Name}}\t{{.Status}}'

echo
echo "==> checks"
printf 'health      : %s (%ss)\n' \
    "$(curl -s -o /dev/null -w '%{http_code}' http://localhost:8000/api/v1/health)" \
    "$(curl -s -o /dev/null -w '%{time_total}' http://localhost:8000/api/v1/health)"
printf 'ui          : %s\n' "$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3010)"

echo
echo "==> networking mode"
if ip -4 addr show eth0 >/dev/null 2>&1; then
    echo "eth0 present  -> NAT mode (mirrored networking did NOT take effect)"
else
    echo "no eth0       -> mirrored networking is active"
fi

echo
echo "Open http://localhost:3010 and hard-refresh (Ctrl+Shift+R) before testing audio."
