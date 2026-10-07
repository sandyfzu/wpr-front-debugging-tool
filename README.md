# WPR Front Debugging Tool

Browser extension for debugging the [WP Rocket](https://wp-rocket.me) WordPress plugin on the front end: running-target detection, runtime error capture, cache/CDN insights, an Exclusion Builder, and more. Built for Chromium first (Manifest V3), Firefox second.

## Stack

[WXT](https://wxt.dev) (extension framework) + [SolidJS](https://solidjs.com) + TypeScript strict + Tailwind CSS v4, tested with Vitest.

## Development

```bash
pnpm install            # Node 24, pnpm (see .nvmrc / packageManager)
pnpm dev                # dev build + watch → load .output/chrome-mv3 as an unpacked extension
pnpm test               # unit tests incl. coverage thresholds (the `test` gate)
pnpm compile && pnpm lint && pnpm format:check   # types, eslint, prettier
pnpm build && pnpm check:budgets   # production build + size-budget gate
```

Design tokens (light/dark/system appearance, status vocabulary, motion) live in `assets/css/theme.css`; every surface imports them and a unit test pins WCAG AA contrast for the committed text/background pairs in both palettes.

See `AGENTS.md` for the full operating guide and `docs/plans/` for the port plan.
