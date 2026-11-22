import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { db } from '../src/lib/db';
import { D, fixed } from '../src/lib/finance';
import { dataFor, perform, executeTrade } from '../src/lib/service';
import { actionSchema } from '../src/lib/validation';
import { ensureSimulated, quote, refreshMarket } from '../src/lib/market';
import { seedDemo } from '../src/lib/seed';
if (!new URL(process.env.DATABASE_URL || 'postgresql://invalid/invalid').pathname.endsWith('_test'))
  throw new Error('Dedicated _test database required.');
after(() => db.$disconnect());
const act = (id: string, input: unknown) => perform(id, actionSchema.parse(input));
test('PostgreSQL paper orders are atomic, idempotent, tenant-scoped and reconcile equity with realized/unrealized P&L', async () => {
  await ensureSimulated();
  const spaces = await Promise.all(
    ['A', 'B'].map((name) => db.workspace.create({ data: { name: 'Synthetic ' + name } })),
  );
  const [a, b] = spaces.map((w) => w.id);
  try {
    const q = await quote('AAPL', 'SIMULATED');
    assert.ok(q);
    const funds = D(q.close).mul(1.5).toFixed(2);
    const p = await act(a, {
      action: 'portfolio.create',
      name: 'Synthetic ledger',
      source: 'SIMULATED',
      startingCash: funds,
      benchmark: 'SPY',
    });
    const id = p.id!;
    await assert.rejects(() => dataFor(b, id));
    await assert.rejects(() =>
      act(b, {
        action: 'trade.execute',
        portfolioId: id,
        symbol: 'AAPL',
        side: 'BUY',
        quantity: '1',
        fee: '0',
        idempotencyKey: randomUUID(),
      }),
    );
    const order = {
      symbol: 'AAPL',
      side: 'BUY' as const,
      quantity: '1',
      fee: '0',
      idempotencyKey: 'first',
    };
    const results = await Promise.allSettled([
      executeTrade(id, order),
      executeTrade(id, { ...order, idempotencyKey: 'second' }),
    ]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(await db.trade.count({ where: { portfolioId: id } }), 1);
    const original = await db.trade.findFirstOrThrow({ where: { portfolioId: id } });
    await executeTrade(id, { ...order, idempotencyKey: original.idempotencyKey });
    assert.equal(await db.trade.count({ where: { portfolioId: id } }), 1);
    await executeTrade(id, {
      ...order,
      side: 'SELL',
      quantity: '0.4',
      fee: '0.01',
      idempotencyKey: 'partial-sale',
    });
    let d = await dataFor(a, id);
    assert.equal(d.positions[0].quantity, '0.600000');
    assert.equal(
      fixed(D(d.summary!.netPnl!).minus(D(d.summary!.realizedPnl).plus(d.summary!.unrealizedPnl!))),
      '0.00000000',
    );
    const deposit = {
      action: 'cash.flow',
      portfolioId: id,
      kind: 'DEPOSIT',
      amount: '50',
      idempotencyKey: 'deposit-one',
    };
    await act(a, deposit);
    await act(a, deposit);
    assert.equal(await db.cashFlow.count({ where: { portfolioId: id } }), 2);
    await assert.rejects(() =>
      act(a, { ...deposit, kind: 'WITHDRAW', amount: '9999999', idempotencyKey: 'excess' }),
    );
    const portfolio = await db.portfolio.findUniqueOrThrow({ where: { id } });
    await act(a, {
      action: 'portfolio.update',
      id,
      name: portfolio.name,
      description: 'Saved settings',
      benchmark: 'SPY',
      riskFreeRate: 0.04,
      source: 'PROVIDER',
    });
    assert.equal((await db.portfolio.findUniqueOrThrow({ where: { id } })).source, 'SIMULATED');
    d = await dataFor(a, id);
    assert.equal(d.source, 'SIMULATED');
    assert.ok(d.quotes.every((q) => q.source === 'SIMULATED'));
    assert.ok(d.summary!.equity);
    assert.equal(d.summary!.tradeCount, 2);
  } finally {
    await db.workspace.deleteMany({ where: { id: { in: spaces.map((w) => w.id) } } });
  }
});
test('demo reset is atomic, isolated and backed by actual historical synthetic ledger entries', async () => {
  const w = await db.workspace.create({ data: { name: 'Synthetic demo', demo: true } }),
    other = await db.workspace.create({ data: { name: 'Private workspace' } });
  try {
    await seedDemo(w.id);
    let d = await dataFor(w.id);
    assert.equal(d.portfolios.length, 2);
    assert.equal(d.trades.length, 8);
    assert.ok(d.history.length > 100);
    assert.ok(d.risk.samples > 100);
    assert.equal(d.unpricedSymbols.length, 0);
    await act(w.id, { action: 'demo.reset' });
    d = await dataFor(w.id);
    assert.equal(d.portfolios.length, 2);
    assert.equal(d.trades.length, 8);
    assert.equal((await dataFor(other.id)).portfolios.length, 0);
    await assert.rejects(() => act(other.id, { action: 'demo.reset' }));
  } finally {
    await db.workspace.deleteMany({ where: { id: { in: [w.id, other.id] } } });
  }
});
test('provider adapter persists real-shaped observations with explicit provenance and retains cached values after errors', async () => {
  const old = process.env.ALPHAVANTAGE_API_KEY;
  process.env.ALPHAVANTAGE_API_KEY = 'synthetic-test-only-provider-key';
  const symbol = 'Q' + randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
  try {
    const day = new Date().toISOString().slice(0, 10),
      payload = {
        'Meta Data': { '2. Symbol': symbol },
        'Time Series (Daily)': {
          [day]: {
            '1. open': '100',
            '2. high': '103',
            '3. low': '99',
            '4. close': '101.25',
            '5. volume': '100000',
          },
        },
      };
    await refreshMarket(symbol, async (url) => {
      assert.equal(new URL(String(url)).hostname, 'www.alphavantage.co');
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    const first = await quote(symbol, 'PROVIDER');
    assert.equal(first?.close, '101.25000000');
    assert.equal(first?.source, 'PROVIDER');
    assert.equal(await quote(symbol, 'SIMULATED'), null);
    await db.providerState.update({
      where: { symbol },
      data: { lastAttemptAt: new Date(Date.now() - 120000) },
    });
    await assert.rejects(() =>
      refreshMarket(
        symbol,
        async () => new Response('{"Information":"Rate limit"}', { status: 200 }),
      ),
    );
    assert.equal((await quote(symbol, 'PROVIDER'))?.close, '101.25000000');
    assert.ok((await db.providerState.findUniqueOrThrow({ where: { symbol } })).error);
  } finally {
    await db.instrument.deleteMany({ where: { symbol } });
    await db.providerState.deleteMany({ where: { symbol } });
    if (old === undefined) delete process.env.ALPHAVANTAGE_API_KEY;
    else process.env.ALPHAVANTAGE_API_KEY = old;
  }
});
