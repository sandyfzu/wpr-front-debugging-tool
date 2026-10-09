#!/usr/bin/env bash
# Stop the local WordPress debugging site. Keeps all volumes: the next up.sh boots the
# site exactly as it was (self-resetting fixtures stay intact) and re-runs the bootstrap
# convergence at speed. For a true wipe-and-rebuild use docker/scripts/reset.sh.
set -Eeuo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repo_root/docker"

dock_compose() {
	docker compose -f docker-compose.yml --env-file .env "$@"
}
if [ -f .env ]; then
	dock_compose down
else
	# No .env yet: nothing was ever booted from this tree.
	printf 'down: no docker/.env — nothing to stop\n'
	exit 0
fi
printf 'down: stopped (volumes kept — reset.sh wipes them)\n'
