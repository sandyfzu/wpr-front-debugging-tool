# Phase 11.1 — Detection-coverage site matrix (browser suites)

**Depends on:** P4.1, P4.2, P11. **Effort:** M–L (matrix breadth). **Parallelizable with:** P12 implementation.

## TLDR

Convert P11's side-by-side detection matrix into scripted site rounds: flip WP Rocket optimization combinations via wp-cli between rounds, capture, and assert the merged-detection card states (meta + strongest-footprint union per fix's rule) over the P4.1/P5.1/P6.1 panel-drive surfaces. The inspector-build comparison that stays manual is the only non-automated row.

## Suites

1. **Optimization-combination rounds (3+ scripted):** wp-cli toggles (cache/LazyLoad/delay/RUCSS/etc.) per round; slashes of `data-wpr-features`, footprints, and headers captured; card states asserted from P11's §3 rule (meta authoritative, exceptions named).
2. **Stripped-signature round:** the SiteGround/Cloudflare-style "possibly cached" subtitle names the hit marker when cache headers are stripped (fixture: header-stripping route/buffer on the harness side); the `x-sg-optimizer`/`cf-cache-status` captures appear in the headers viewer when sent.
3. **No-footprint round:** four no-meta/no-footprint cards state their "no footprint known" nuance with exactly the mandated language paths — never asserting enabled/disabled where nothing is known.
4. **Captures land in the panel pages** (P6.1 surfaces): Detections card headers, JS section, per features correctly without consulting footprints where the union rule forbids it.

## Definition of done

- Matrix runs scripted by sequence (pinned combinations) and asserted; runbook committed (`docker/` round list + expected states per round).
- P11's checklist annotated; the manual contrast row (inspector side-by-side judgment) named with reason.

## Stays manual

Inspector-build side-by-side comparisons (requires the other extension in dev mode next to ours); crafting new fixture _content_ for a newly discovered plugin behavior — the suite machinery handles it once added.
