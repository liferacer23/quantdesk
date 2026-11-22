# QuantDesk progress

Updated 2026-11-22. Independent repository on `build/quantdesk`; separate dev/test PostgreSQL databases. Deployment remains deferred.

## Completed

- Precise transactional paper ledger, fractional positions, average basis, fees, realized/unrealized P&L, virtual cash flows, idempotency and row-lock concurrency.
- Source-isolated synthetic versus Alpha Vantage EOD prices, validated provider adapter, leases, rate budgets, cached freshness/errors and explicit unavailable states.
- Portfolio/market/watchlist/risk/rebalance/trade/settings product views, actual candlestick chart, benchmark/TWR/drawdown charts, target weights, persistent CRUD, accessible OHLC tables, CSV reports, keyboard navigation and themes.
- Real password/session authentication, server tenant checks, CSRF origin validation, audited actions, isolated/resettable synthetic demos, scheduled expiry handler.
- README, architecture/database decisions, environment/setup/release instructions, MIT license, wordmark, actual desktop/mobile screenshots and GitHub Actions.

## Executed verification

- Frozen pnpm dependency installation: passed.
- TypeScript, ESLint, Prettier, production build: passed.
- 13 domain/database tests: passed.
- 18 E2E tests against production server: passed, desktop Chromium and iPhone WebKit. Actual core workflows and tenant/CSRF boundaries exercised, no skipped/forced interactions.
- Visual review of actual desktop/mobile screenshots: passed.
- Security audit attempted: failed with registry ETIMEDOUT, no current advisory clearance. Previously identified shared-stack critical/high dependency advisories remain a release blocker. Never claim security cleared.

## Architecture / limits

Single Next.js serverless-compatible app + PostgreSQL; Decimal cash ledger; public observations separated by source; tenant portfolios and watchlists. Immutable source prevents synthetic basis being valued with real data. Daily unadjusted prices, USD long-only paper trading; no dividends/splits/tax/broker execution. Optional provider access has not been live-verified because no credential is configured. Data contract and persistence tested with a dependency-injected test-only response.

## Publication / next steps

Personal GitHub account `liferacer23` / type User verified. Repository availability checked (did not exist). Publication target: https://github.com/liferacer23/quantdesk, branch `build/quantdesk`. Exact remote ownership/public visibility/SHA verification is required after the source push; the parent portfolio checkpoint records that result. Roamly is next. All deployments remain on hold.
