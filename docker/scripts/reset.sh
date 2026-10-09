#!/usr/bin/env bash
# Full reset of the local WordPress debugging site: remove containers AND volumes
# (database, WordPress core, cache and installed plugins), then reboot to a fresh,
# identical site state. The bootstrap re-installs everything — including WP Rocket from
# docker/wpr/wpr-rocket.zip and the conflict-plugin set — so no manual step remains.
set -Eeuo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repo_root/docker"

if [ ! -f .env ]; then
	# Not booted from this tree yet: no volumes exist — plain up.sh is the whole job.
	exec "$repo_root/docker/scripts/up.sh"
fi
docker compose -f docker-compose.yml --env-file .env down -v
exec "$repo_root/docker/scripts/up.sh"
