import { z } from 'zod';
import { db } from './db';
import { D } from './finance';
import { HttpError } from './http';
export const universe = [
  { symbol: 'AAPL', name: 'Apple Inc.', sector: 'Technology', assetClass: 'EQUITY', base: 168 },
  {
    symbol: 'MSFT',
    name: 'Microsoft Corporation',
    sector: 'Technology',
    assetClass: 'EQUITY',
    base: 355,
  },
  {
    symbol: 'NVDA',
    name: 'NVIDIA Corporation',
    sector: 'Technology',
    assetClass: 'EQUITY',
    base: 92,
  },
  {
    symbol: 'AMZN',
    name: 'Amazon.com Inc.',
    sector: 'Consumer discretionary',
    assetClass: 'EQUITY',
    base: 158,
  },
  {
    symbol: 'GOOGL',
    name: 'Alphabet Inc.',
    sector: 'Communication services',
    assetClass: 'EQUITY',
    base: 145,
  },
  {
    symbol: 'META',
    name: 'Meta Platforms Inc.',
    sector: 'Communication services',
    assetClass: 'EQUITY',
    base: 420,
  },
  {
    symbol: 'TSLA',
    name: 'Tesla Inc.',
    sector: 'Consumer discretionary',
    assetClass: 'EQUITY',
    base: 215,
  },
  {
    symbol: 'SPY',
    name: 'SPDR S&P 500 ETF Trust',
    sector: 'Broad market',
    assetClass: 'ETF',
    base: 470,
  },
  {
    symbol: 'QQQ',
    name: 'Invesco QQQ Trust',
    sector: 'Growth equities',
    assetClass: 'ETF',
    base: 405,
  },
  {
    symbol: 'VTI',
    name: 'Vanguard Total Stock Market ETF',
    sector: 'Broad market',
    assetClass: 'ETF',
    base: 232,
  },
  {
    symbol: 'BND',
    name: 'Vanguard Total Bond Market ETF',
    sector: 'Fixed income',
    assetClass: 'ETF',
    base: 72,
  },
] as const;
export async function ensureSimulated() {
  const today = new Date().toISOString().slice(0, 10);
  const latest = await db.candle.findFirst({
    where: { source: 'SIMULATED', symbol: 'SPY' },
    orderBy: { date: 'desc' },
  });
  const lastBusiness = new Date(today + 'T00:00:00Z');
  while ([0, 6].includes(lastBusiness.getUTCDay()))
    lastBusiness.setUTCDate(lastBusiness.getUTCDate() - 1);
  if (latest && latest.date.toISOString().slice(0, 10) === lastBusiness.toISOString().slice(0, 10))
    return;
  await db.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(70261122)::text`;
      const dates: string[] = [];
      for (let age = 460; age >= 0; age--) {
        const d = new Date(+lastBusiness - age * 86400000);
        if (![0, 6].includes(d.getUTCDay())) dates.push(d.toISOString().slice(0, 10));
      }
      for (const [j, item] of universe.entries()) {
        const { base: _, ...instrument } = item;
        await tx.instrument.upsert({
          where: { symbol: item.symbol },
          create: instrument,
          update: instrument,
        });
        // Deterministic fictional market observations, always stored with SIMULATED provenance.
        const data = dates.map((date) => {
          const day = Math.floor(+new Date(date + 'T00:00:00Z') / 86400000);
          const trend = (day - 20000) * 0.00018;
          const wave =
            Math.sin(day / (21 + j * 2) + j) * 0.045 + Math.sin(day / (4.3 + j * 0.2) + j) * 0.012;
          const close = D(item.base).mul(Math.exp(trend + wave));
          const open = close.mul(1 + Math.sin(day + j) * 0.006);
          const high = D(open.gt(close) ? open : close).mul(1.008);
          const low = D(open.lt(close) ? open : close).mul(0.992);
          return {
            symbol: item.symbol,
            source: 'SIMULATED',
            date: new Date(date + 'T00:00:00Z'),
            open: open.toFixed(8),
            high: high.toFixed(8),
            low: low.toFixed(8),
            close: close.toFixed(8),
            volume: BigInt(1000000 + ((day * 7919 * (j + 1)) % 30000000)),
          };
        });
        await tx.candle.createMany({ data, skipDuplicates: true });
      }
    },
    { timeout: 20000 },
  );
}
const decimal = z.string().regex(/^\d+(\.\d+)?$/);
export function parseDaily(payload: unknown, symbol: string) {
  const parsed = z
    .object({
      'Meta Data': z.object({ '2. Symbol': z.string() }),
      'Time Series (Daily)': z.record(
        z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        z.object({
          '1. open': decimal,
          '2. high': decimal,
          '3. low': decimal,
          '4. close': decimal,
          '5. volume': z.string().regex(/^\d+$/),
        }),
      ),
    })
    .safeParse(payload);
  if (!parsed.success || parsed.data['Meta Data']['2. Symbol'].toUpperCase() !== symbol)
    throw new HttpError(
      502,
      'The provider returned unavailable, limited or unrecognized daily data.',
    );
  const rows = Object.entries(parsed.data['Time Series (Daily)'])
    .map(([date, row]) => {
      const open = D(row['1. open']),
        high = D(row['2. high']),
        low = D(row['3. low']),
        close = D(row['4. close']);
      const at = new Date(date + 'T00:00:00Z');
      if (
        !Number.isFinite(+at) ||
        at.toISOString().slice(0, 10) !== date ||
        date > new Date().toISOString().slice(0, 10) ||
        open.lte(0) ||
        low.lte(0) ||
        high.lt(open) ||
        high.lt(close) ||
        low.gt(open) ||
        low.gt(close) ||
        high.gt(1000000000) ||
        row['5. volume'].length > 18
      )
        throw new HttpError(502, 'The provider returned invalid OHLC or volume values.');
      return {
        symbol,
        source: 'PROVIDER',
        date: at,
        open: open.toFixed(8),
        high: high.toFixed(8),
        low: low.toFixed(8),
        close: close.toFixed(8),
        volume: BigInt(row['5. volume']),
      };
    })
    .sort((a, b) => +a.date - +b.date);
  if (!rows.length) throw new HttpError(502, 'No daily observations were returned.');
  return rows;
}
export async function refreshMarket(symbol: string, fetcher: typeof fetch = fetch) {
  if (!process.env.ALPHAVANTAGE_API_KEY)
    throw new HttpError(
      503,
      'Real end-of-day market data is not configured. Simulated data stays explicitly labeled.',
    );
  const now = new Date();
  await db.providerState.upsert({ where: { symbol }, create: { symbol }, update: {} });
  const claimed = await db.providerState.updateMany({
    where: {
      symbol,
      AND: [
        { OR: [{ leasedUntil: null }, { leasedUntil: { lt: now } }] },
        { OR: [{ lastAttemptAt: null }, { lastAttemptAt: { lt: new Date(+now - 60000) } }] },
      ],
    },
    data: { lastAttemptAt: now, leasedUntil: new Date(+now + 30000) },
  });
  if (!claimed.count)
    throw new HttpError(429, 'This symbol was refreshed recently or is already refreshing.');
  try {
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(70261123)::text`;
      for (const [period, limit] of [
        [Math.floor(+now / 60000), 4],
        [Math.floor(+now / 86400000), 20],
      ] as const) {
        const key = 'provider:' + limit + ':' + period;
        const b = await tx.rateLimit.upsert({
          where: { key },
          create: { key, count: 1, expiresAt: new Date(+now + 86400000) },
          update: { count: { increment: 1 } },
        });
        if (b.count > limit)
          throw new HttpError(
            429,
            'The application’s free-tier provider request budget is exhausted. Cached data retains its original observation date.',
          );
      }
    });
    const url = new URL('https://www.alphavantage.co/query');
    url.searchParams.set('function', 'TIME_SERIES_DAILY');
    url.searchParams.set('symbol', symbol);
    url.searchParams.set('outputsize', 'compact');
    url.searchParams.set('apikey', process.env.ALPHAVANTAGE_API_KEY);
    const response = await fetcher(url, { signal: AbortSignal.timeout(10000), cache: 'no-store' });
    if (!response.ok) throw new HttpError(502, 'The market data provider is unavailable.');
    const rows = parseDaily(await response.json(), symbol);
    await db.$transaction(
      async (tx) => {
        await tx.instrument.upsert({
          where: { symbol },
          create: { symbol, name: symbol },
          update: {},
        });
        for (const row of rows)
          await tx.candle.upsert({
            where: { symbol_source_date: { symbol, source: 'PROVIDER', date: row.date } },
            create: row,
            update: { ...row, fetchedAt: new Date() },
          });
        await tx.providerState.update({
          where: { symbol },
          data: { lastSuccessAt: new Date(), error: null, leasedUntil: null },
        });
      },
      { timeout: 15000 },
    );
    return {
      message: `Cached ${rows.length} Alpha Vantage daily observations. End-of-day data, not live quotes.`,
    };
  } catch (error) {
    await db.providerState.update({
      where: { symbol },
      data: {
        error:
          error instanceof HttpError
            ? error.message
            : 'Provider request failed. Existing cached prices are unchanged.',
        leasedUntil: null,
      },
    });
    if (error instanceof HttpError) throw error;
    throw new HttpError(
      502,
      'Provider request failed. Existing cached prices keep their original observation date.',
    );
  }
}
export async function quote(symbol: string, source: string) {
  const candle = await db.candle.findFirst({
    where: { symbol, source },
    orderBy: { date: 'desc' },
  });
  if (!candle) return null;
  return {
    symbol,
    source,
    date: candle.date.toISOString().slice(0, 10),
    close: candle.close.toFixed(8),
    fetchedAt: candle.fetchedAt.toISOString(),
    stale: Date.now() - +candle.date > 7 * 86400000,
  };
}
