# Phase 4.2 — Local WordPress site (docker compose + mu-plugin fixtures + WP Rocket)

**Depends on:** — . **Effort:** M. **Parallelizable with:** P4.1 (and with all P5+ implementation work).

## TLDR

A reproducible **local WordPress environment in this repo** — Docker Compose, wp-admin test credentials in a git-ignored `.env`, WP Rocket installed from an `apvm`-built zip, free Known-Conflicts plugins preinstalled, and mu-plugin fixtures that inject the deterministic problems the debug tool exists to catch. The default site for every browser suite (owner decision: docker is the default; external real site is future scope only for what docker cannot fake).

## Goal

Make the "real site" checklists (P2–P4 retro suites in P4.3, later X.1 suites, the P7 diagnoser plugin, P11 detection matrix, P13 RUCSS runs, P14 beacon rounds) runnable on demand locally — always the same shape, self-resetting fixtures, no drifting server state.

## Contents

- `docker/docker-compose.yml`: WordPress (php-apache) + MariaDB + wp-cli bootstrap service; one command up/down/reset; document reset semantics (fixtures must survive a WP Rocket cache purge).
- WP Rocket installed from `docker/wpr/wpr-rocket.zip` produced by **`apvm build`** at harness time (pinned tag/branch recorded in the compose config; the zip itself never committed). Domain activation behavior verified empirically during this phase and recorded in this doc (localhost-domain handling) — never asserted from memory.
- **mu-plugin fixture plugin** (`docker/fixtures/`, mounted into `wp-content/mu-plugins`): the fixture strategy is code-injection (owner-delegated decision) —
  - query-flags flip scenarios per page (`?fdt-error=reference|reading|notfunction`, `?fdt-delay=1` making Delay JS genuinely produce the undefined reference, controlled `data-rocket-status` markup when DelayJS executes, beacon-friendly pages);
  - behavior fixtures that the Exclusion Builder (P10) targets;
  - self-resetting: nothing in the admin UI needs hand-configuring between runs.
- Preinstalled **free conflict plugins** filtered from the committed 121-row KC DB (`docker/conflicts.txt` committed list; wp.org-installable only) so `plugins.php` produces real matches.
- Slot for the **Support Diagnoser plugin** (P7) — included at build time when its phase lands, same install path.
- `.env.example` + gitignored `.env` (already ignored repo-wide as of 2026-10-08); credentials copied into place by the harness if missing, never logged.
- Optional HTTPS via mkcert (http alone is functional — the extension matches `http://*/*`); document the switch, don't require it.

## Definition of done

- One command boots the site; smoke: WP loads, WP Rocket active with real feature toggles operable, a conflict plugin visible on `plugins.php`, at least one fixture page produces its scripted problem (e.g. a Delay-JS-driven `ReferenceError`).
- `apvm` build + install path documented; versions pinned; secrets proven absent from the tree (`git status` clean with `.env` in place).
- This repo's regular gates untouched (compose files live outside measured/compiled surfaces; prettier-clean YAML).
- `docs/` gains a short runbook (URLs, creds, reset, scenario flags), linked from here.

## Stays out of this phase

Live external services (PSI production runs, HelpScout) — fixture-served locally or P14.6 later.
