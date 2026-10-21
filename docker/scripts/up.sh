#!/usr/bin/env bash
# Boot the local WordPress debugging site (the one-command entry point).
#
# Order of checks, each actionable on failure:
#   1. .env present (auto-copied from .env.example on first use, never printed)
#   2. the apvm-built WP Rocket zip exists at docker/wpr/wpr-rocket.zip
#   3. the configured host port is free
# then: db + site up, wp-bootstrap one-shot runs to convergence (output visible here),
# smoke-check the site, print the entry points. Credentials live in docker/.env and are
# never echoed: the bootstrap consumes them via its compose environment.
set -Eeuo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
docker_dir="$repo_root/docker"
cd "$docker_dir"

if [ ! -f .env ]; then
	# First-run convenience: the copy seeds this machine's git-ignored test credentials.
	cp .env.example .env
	printf 'up: created docker/.env from .env.example (local-only credentials — edit freely, never commit)\n'
fi
# The harness sources the config but never prints it.
# shellcheck source=/dev/null
. ./.env

if [ ! -f wpr/wpr-rocket.zip ]; then
	printf 'up: missing docker/wpr/wpr-rocket.zip\n' >&2
	printf '    build it (once, then it stays in place):\n' >&2
	printf '      apvm build wp-rocket tag:latest-stable /tmp/wpr-out\n' >&2
	printf '      mkdir -p docker/wpr && cp /tmp/wpr-out/wp-rocket-*.zip docker/wpr/wpr-rocket.zip\n' >&2
	exit 1
fi

# The port must be free unless a container of this stack (name: wprfdt) is the
# listener — a re-run then converges in place instead of failing on itself.
if lsof -nP -iTCP:"${WPR_FDT_TCP_PORT}" -sTCP:LISTEN 2>/dev/null | grep -q .; then
	if ! docker ps --format '{{.Names}}' 2>/dev/null | grep -q '^wprfdt-'; then
		printf 'up: port %s is already taken — free it or set WPR_FDT_TCP_PORT in docker/.env\n' "${WPR_FDT_TCP_PORT}" >&2
		exit 1
	fi
	printf 'up: port %s is held by this stack already — converging in place\n' "${WPR_FDT_TCP_PORT}"
fi

compose() {
	docker compose -f docker-compose.yml --env-file .env "$@"
}

# Readiness marker (docker/state, bind-mounted): removed before anything boots, written
# by the bootstrap's last step — so the browser tier's readiness URL can never answer
# from a previous boot while this one is still converging.
# The bootstrap writes as uid 33 (the site's www-data), which on a Linux bind mount
# cannot write a host-user 755 dir; 1777 (the /tmp mode) lets it create the marker
# while the sticky bit keeps others from deleting files they don't own — this dir
# owner (up.sh's user) still can, which the `rm` below needs. Only the marker lives here.
mkdir -p state
if ! chmod 1777 state; then
	# e.g. docker auto-created the bind source as root before up.sh ever ran.
	printf 'up: cannot set the mode of docker/state (owned by another user?) — remove it (sudo rm -rf docker/state) and re-run\n' >&2
	exit 1
fi
rm -f state/bootstrap-ready.txt

compose up -d db wordpress

# The bootstrap is a profiled one-shot: up.sh alone drives it (a plain `up -d` never
# re-runs exited one-shots, which would break the re-apply-everything-per-boot rule).
# `run` propagates the bootstrap's exit code and streams its output here.
compose run --rm wp-bootstrap

# Site smoke: WordPress answering over the configured port (no output, no secrets).
for _ in {1..30}; do
	if curl -fsS -o /dev/null --max-time 5 "http://127.0.0.1:${WPR_FDT_TCP_PORT}/" 2>/dev/null; then
		break
	fi
	printf 'up: waiting for %s on port %s ...\n' 'the site' "${WPR_FDT_TCP_PORT}"
	sleep 2
done
if ! curl -fsS -o /dev/null --max-time 5 "http://127.0.0.1:${WPR_FDT_TCP_PORT}/" 2>/dev/null; then
	printf 'up: site did not answer — inspect with: docker compose -f docker-compose.yml --env-file .env logs wordpress\n' >&2
	exit 1
fi

printf 'up: site ready — http://127.0.0.1:%s\n' "${WPR_FDT_TCP_PORT}"
printf 'up: fixture hub  — http://127.0.0.1:%s/fdt/ (scenario flags in the runbook)\n' "${WPR_FDT_TCP_PORT}"
printf 'up: wp-admin     — http://127.0.0.1:%s/wp-admin/ (credentials in docker/.env)\n' "${WPR_FDT_TCP_PORT}"
