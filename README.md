<p align="center"><img src="public/wordmark.svg" width="270" alt="QuantDesk" /></p>

# A clearer view. A sharper thesis.

QuantDesk is an investment research terminal with precise paper portfolios, transparent daily price provenance, benchmark comparisons and a fee-aware rebalancing simulator. Every holding, chart and report is backed by a PostgreSQL ledger.

**Status:** built and tested locally. Public deployment is intentionally deferred. There is no hosted demo URL yet. The homepage opens a working, isolated demo immediately after local setup.

![Portfolio terminal](public/screenshots/desktop-portfolio.png)

<details><summary>Market research and mobile views</summary>

![Daily candlestick research](public/screenshots/desktop-markets.png)
<img src="public/screenshots/mobile-portfolio.png" width="320" alt="Mobile portfolio overview" />

</details>

## Product workflows

- Separate paper portfolios, virtual deposits/withdrawals, fractional buys/sells, fees, average cost basis and realized/unrealized P&L.
- Atomic, idempotent orders; cash and positions reconcile with immutable trade/cash-flow records. Concurrent orders cannot spend the same funds.
- Real Alpha Vantage unadjusted end-of-day data behind an optional server credential. Fixed provider endpoint, input validation, cache leases, rate budgets and explicit stale/unavailable states.
- A portfolio’s price source is immutable. Fictional seeded prices are always labeled **SIMULATED**; they never become live prices or silently replace provider observations.
- Searchable, sortable, paginated market universe; interactive TradingView Lightweight Charts candlesticks, pan/zoom, OHLC table and source dates.
- Persistent watchlists with symbol add/remove; uncovered symbols remain unavailable.
- Cash-flow-adjusted time-weighted returns, daily equity, price-only benchmarks, allocation weights, annualized volatility, Sharpe and drawdown charts.
- Rebalance previews with fractional quantities, estimated fees, turnover and funding checks. Saving targets does not submit orders.
- Immutable trade history, virtual cash history, audit timeline and CSV portfolio reports with spreadsheet-formula protection.
- Password authentication, tenant-scoped data access, origin checks, hashed sessions, demo isolation/reset/expiry, theme switching and keyboard navigation (`⌘/Ctrl K`).

All orders and capital are virtual. There is no brokerage integration or execution of real trades.

## Architecture

Next.js 16 App Router, React 19, strict TypeScript, Prisma 6, PostgreSQL 16, Decimal.js, Zod, Recharts, Lightweight Charts 5, Lucide, Node test runner and Playwright. CSS design tokens implement a navy/cyan research terminal without an extra component framework.

```mermaid
flowchart LR
  Browser[Terminal / authenticated session] --> Routes[Next.js route handlers]
  Routes --> Scope[Session + origin + Zod + tenant scope]
  Scope --> Ledger[Portfolio row lock / Decimal ledger]
  Scope --> Analytics[Daily valuation / TWR / risk / rebalance]
  Scope --> Adapter[Market adapter / lease / rate budget]
  Ledger --> PG[(PostgreSQL)]
  Analytics --> PG
  Adapter --> PG
  Adapter --> AV[Alpha Vantage daily endpoint]
  Demo[Isolated synthetic workspace] --> Ledger
```

### Design decisions

`src/lib/finance.ts` contains deterministic calculation modules. Financial balances and cost basis use Decimal arithmetic and `Decimal(24,8)` storage; quantities accepted through the API have at most six decimal places. Binary floating point is reserved for statistical chart series, not the cash ledger.

Orders acquire a portfolio row lock, check an idempotency key, resolve a price from the portfolio’s fixed source, validate funds/holdings, and update cash, cost basis, position and audit inside one transaction. Fees enter acquisition basis or reduce sale proceeds. Full liquidation releases all remaining basis.

`src/lib/market.ts` owns validated source-specific observations. Provider refreshes claim a short lease and enforce a conservative shared budget of four requests/minute and twenty/day. Errors retain the previous cache and its observation date. No paid request is made by tests. Public demos cannot create real-provider portfolios or consume provider credentials.

### Database overview

- `Workspace`, `User`, `Session`: tenant ownership, scrypt password hashes, SHA-256 session-token hashes and expiry.
- `Portfolio`, `Position`, `Trade`, `CashFlow`: immutable price provenance, materialized balances, average basis and idempotency constraints.
- `Instrument`, `Candle`: shared public instruments with unique symbol/source/date observations, indexed for historical and latest-price queries.
- `ProviderState`, `RateLimit`: refresh leases, success/error metadata and request budgets.
- `Watchlist`, `Audit`: workspace-owned research lists and recent actions.

All tenant endpoints resolve resources through the authenticated workspace. Public market observations are shared; holdings, balances and watchlists are private. Database integration tests exercise foreign workspace IDs, duplicate orders, concurrent spending and demo boundaries.

## Run locally

Requires Node 22, pnpm 9.15.4, and PostgreSQL 16 (or local Docker).

```sh
pnpm install --frozen-lockfile
cp .env.example .env
docker compose up -d
pnpm db:migrate
pnpm dev
```

Open **http://127.0.0.1:3205** and choose **Explore the live demo**, or register for an empty private workspace. Docker binds PostgreSQL only on loopback port 54325. Existing PostgreSQL installations can use their own independent database instead.

### Environment

| Variable               | Purpose                                                                                                 |
| ---------------------- | ------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`         | Required isolated PostgreSQL connection; use a managed pooled connection for serverless deployment.     |
| `APP_URL`              | Exact application origin, used for origin validation and HTTPS session cookies.                         |
| `ALPHAVANTAGE_API_KEY` | Optional server-only daily-price credential. Missing credentials produce an explicit unavailable state. |
| `CRON_SECRET`          | Random server-only bearer token for scheduled demo/session cleanup; blank disables cron access.         |

Never commit `.env` files or provider credentials. Values in `.env.example` are local-only example database credentials.

## Verification

Create an independent **quantdesk_test** database with the same migration set. Tests refuse other database names. Do not use private or production data.

```sh
createdb quantdesk_test
cp .env .env.test
# Change DATABASE_URL in .env.test to the separate quantdesk_test database.
# Apply migrations with DATABASE_URL pointing to that test database:
DATABASE_URL='postgresql://USER:PASSWORD@127.0.0.1:PORT/quantdesk_test?schema=public' pnpm db:migrate
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
pnpm build
pnpm exec playwright install chromium webkit
pnpm test:e2e
pnpm audit --audit-level high
```

Local verification on **2026-11-22**: frozen dependency install, types, lint, production build, **13 domain/database tests** and **18 production-server E2E tests** passed. E2E runs desktop Chromium and iPhone WebKit against the test database with provider credentials blanked. Coverage includes trades, oversell rejection, idempotency, fees, cash flows, watchlist CRUD, risk/candles, rebalance validation, export, authentication, CSRF, tenant isolation, demo reset and portfolio-selection persistence.

GitHub Actions repeats verification with its own PostgreSQL service and uploads browser evidence. Hosted CI results must be checked separately; local success is not a hosted-CI claim. Dependency auditing is a separate, unsuppressed job.

## Deployment preparation — Vercel

Deployment is **on hold at the owner’s direction**. No managed database, cloud services or public demo have been provisioned.

Before a public release:

1. Resolve dependency security advisories and rerun the unsuppressed audit. The shared pinned Next.js/Zod stack has known critical/high advisory findings; registry-recommended patches were unavailable during the portfolio build. Do not treat the local functional checks as security clearance.
2. Connect this personal GitHub repository to Vercel and select a supported Node 22 runtime.
3. Provision a separate managed PostgreSQL database on an approved free tier. Configure the production `DATABASE_URL`, HTTPS `APP_URL`, `CRON_SECRET`, and optional provider key in hosting settings.
4. Apply `pnpm db:migrate` through a controlled release step, then use `pnpm build`. Prisma Client generation is included in the build/postinstall scripts.
5. Schedule a managed authenticated `GET /api/cron` cleanup request using `Authorization: Bearer <CRON_SECRET>`. There is no long-running in-function worker.
6. Smoke-test registration, isolated demo/reset, paper buy/sell, charts, unavailable provider behavior and report export on the actual production domain. Add the verified URL here and to GitHub only after that succeeds.

## Calculation assumptions and limitations

- USD only, long-only paper equity/ETF portfolios. No real trades, margin, shorts, options or currency conversion.
- Provider data is daily **unadjusted** OHLC, never a live feed. Free compact responses contain limited history. No dividends, splits, taxes or corporate-action accounting. Prices must be refreshed before paper fills if more than seven days old.
- The seeded market universe contains real ticker names and **fictional price histories**. Demo results are not historical performance of the named securities.
- TWR treats external flows as end-of-day movements; flows between observations are removed from the next return. Historical prices carry forward to the next valuation. Missing held-asset prices yield unknown equity, never zero.
- Risk statistics use sample daily standard deviation, 252 periods/year and an explicit configurable annual risk-free rate (default 3%). Small samples or zero volatility yield unavailable values. Estimates are descriptive, not forecasts.
- Interactive analytics support up to 5,000 trades/flows and 100,000 candle rows, with explicit truncation warnings. The ledger view shows the latest 100 fills; CSV reports describe current positions and assumptions.
- Single owner per private workspace; no invitation system, password recovery or email verification yet. These account lifecycle features are needed before general public account onboarding.
- Local dependency-audit networking can be unreliable; the previously identified critical/high advisory release blocker remains open until a fresh clean audit is verified.

## Roadmap

Adjusted total-return series with explicit corporate actions, more market adapters, full ledger exports, encrypted provider-credential management, account recovery, additional currencies and benchmark coverage.

## License and attribution

Application code is [MIT licensed](LICENSE). TradingView Lightweight Charts™ is Apache-2.0 licensed; the research chart includes a visible creator link and attribution logo. See [TradingView](https://www.tradingview.com/) and the [Lightweight Charts license](https://github.com/tradingview/lightweight-charts/blob/master/LICENSE). Alpha Vantage data access and redistribution are subject to its provider terms; confirm your intended public-use rights before enabling real provider data on a hosted demo.
