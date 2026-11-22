import { csvCell } from '../src/lib/csv';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  D,
  fixed,
  tradeMath,
  riskMetrics,
  portfolioHistory,
  rebalancePlan,
} from '../src/lib/finance';
import { parseDaily } from '../src/lib/market';
import { actionSchema } from '../src/lib/validation';
test('fractional fills, fees and partial cost-basis release reconcile without binary floating point', () => {
  const buy = tradeMath({
    side: 'BUY',
    quantity: '0.1',
    price: '0.2',
    fee: '0.01',
    cash: '1',
    holding: { quantity: '0', costBasis: '0' },
  });
  assert.equal(fixed(buy.cashDelta), '-0.03000000');
  assert.equal(fixed(buy.costBasis), '0.03000000');
  const sell = tradeMath({
    side: 'SELL',
    quantity: '0.04',
    price: '0.5',
    fee: '0.01',
    cash: D(1).plus(buy.cashDelta),
    holding: buy,
  });
  assert.equal(fixed(sell.costBasisReleased), '0.01200000');
  assert.equal(fixed(sell.realizedPnl), '-0.00200000');
  const final = tradeMath({
    side: 'SELL',
    quantity: '0.06',
    price: '0.5',
    fee: '0',
    cash: D(1).plus(buy.cashDelta).plus(sell.cashDelta),
    holding: sell,
  });
  assert.equal(fixed(final.quantity), '0.00000000');
  assert.equal(fixed(final.costBasis), '0.00000000');
  assert.equal(fixed(sell.realizedPnl.plus(final.realizedPnl)), '0.01000000');
  assert.equal(
    fixed(D(1).plus(buy.cashDelta).plus(sell.cashDelta).plus(final.cashDelta)),
    '1.01000000',
  );
});
test('paper ledger rejects overselling, unfunded fees, negative fees and invalid quantities', () => {
  const base = {
    side: 'BUY' as const,
    quantity: '1',
    price: '10',
    fee: '1',
    cash: '10',
    holding: { quantity: '0.1', costBasis: '1' },
  };
  assert.throws(() => tradeMath(base), /Insufficient/);
  assert.throws(() => tradeMath({ ...base, side: 'SELL' }), /exceeds/);
  assert.throws(() => tradeMath({ ...base, fee: '-1' }));
  assert.throws(() => tradeMath({ ...base, quantity: '0' }));
});
test('risk metrics use sample volatility, explicit annual assumptions and no invented zero-volatility Sharpe', () => {
  const r = riskMetrics([0.01, -0.01, 0.02, -0.02], 0);
  assert.ok(Math.abs(r.volatility! - Math.sqrt(0.001 / 3) * Math.sqrt(252)) < 1e-12);
  assert.equal(r.sharpe, 0);
  assert.ok(Math.abs(r.maxDrawdown! + 0.02) < 1e-12);
  assert.equal(riskMetrics([0.01, 0.01, 0.01]).sharpe, null);
  assert.equal(riskMetrics([0.01]).volatility, null);
  const draw = riskMetrics([0.1, -0.2, 0.05]);
  assert.ok(Math.abs(draw.maxDrawdown! + 0.2) < 1e-12);
  assert.equal(draw.bestDay, 0.1);
  assert.equal(draw.worstDay, -0.2);
});
test('daily valuation removes end-of-day external flows from returns while preserving cash dilution', () => {
  const prices = ['2026-01-01', '2026-01-02', '2026-01-03'].flatMap((date, i) =>
    ['TEST', 'SPY'].map((symbol) => ({ symbol, date, close: ['100', '110', '99'][i] })),
  );
  const h = portfolioHistory(
    [{ symbol: 'TEST', side: 'BUY', quantity: '1', cashDelta: '-100', date: '2026-01-01' }],
    [
      { kind: 'DEPOSIT', amount: '100', date: '2026-01-01' },
      { kind: 'DEPOSIT', amount: '50', date: '2026-01-02' },
      { kind: 'WITHDRAW', amount: '20', date: '2026-01-03' },
    ],
    prices,
    'SPY',
    '2026-01-03',
  );
  assert.equal(h[0].equity, '100.00000000');
  assert.equal(h[1].equity, '160.00000000');
  assert.equal(h[2].equity, '129.00000000');
  assert.ok(Math.abs(h[1].dailyReturn! - 0.1) < 1e-12);
  assert.ok(Math.abs(h[2].dailyReturn! + 0.06875) < 1e-12);
  assert.ok(Math.abs(h[2].index! - 102.4375) < 1e-10);
  assert.equal(h[2].benchmarkIndex, 99);
});
test('unpriced held assets produce unknown valuation and return instead of silently counting them as zero', () => {
  const h = portfolioHistory(
    [{ symbol: 'MISSING', side: 'BUY', quantity: '1', cashDelta: '-50', date: '2026-01-01' }],
    [{ kind: 'DEPOSIT', amount: '100', date: '2026-01-01' }],
    [{ symbol: 'SPY', date: '2026-01-01', close: '100' }],
    'SPY',
    '2026-01-01',
  );
  assert.equal(h[0].equity, null);
  assert.equal(h[0].index, null);
});
test('rebalancing validates weights and funding after estimated fees without submitting orders', () => {
  const base = {
    equity: '1000',
    cash: '500',
    positions: [{ symbol: 'TEST', quantity: '5', value: '500' }],
    prices: { TEST: '100' },
    weights: { TEST: 100, CASH: 0 },
    fee: '2',
  };
  const r = rebalancePlan(base);
  assert.equal(r.rows[0].side, 'BUY');
  assert.equal(r.rows[0].quantity, '5.000000');
  assert.equal(r.estimatedCash, '-2.00000000');
  assert.equal(r.feasible, false);
  assert.throws(() => rebalancePlan({ ...base, weights: { TEST: 80, CASH: 10 } }), /100%/);
  assert.equal(rebalancePlan({ ...base, weights: { TEST: 80, CASH: 20 } }).feasible, true);
});
test('provider adapter validates symbol, calendar dates, OHLC structure and integer volume', () => {
  const data = {
    'Meta Data': { '2. Symbol': 'TEST' },
    'Time Series (Daily)': {
      '2026-01-02': {
        '1. open': '100.25',
        '2. high': '103',
        '3. low': '99',
        '4. close': '101.125',
        '5. volume': '123456789',
      },
    },
  };
  const parsed = parseDaily(data, 'TEST');
  assert.equal(parsed[0].close, '101.12500000');
  assert.equal(parsed[0].volume, 123456789n);
  assert.throws(() => parseDaily(data, 'OTHER'));
  const bad = structuredClone(data);
  bad['Time Series (Daily)']['2026-01-02']['2. high'] = '100';
  assert.throws(() => parseDaily(bad, 'TEST'));
  assert.throws(() => parseDaily({ Information: 'Rate limited' }, 'TEST'));
});
test('financial actions validate money precision, positive quantities and explicit data source', () => {
  assert.equal(
    actionSchema.safeParse({
      action: 'trade.execute',
      portfolioId: 'p',
      symbol: 'AAPL',
      side: 'BUY',
      quantity: '0.000001',
      fee: '1.25',
      idempotencyKey: 'one',
    }).success,
    true,
  );
  assert.equal(
    actionSchema.safeParse({
      action: 'trade.execute',
      portfolioId: 'p',
      symbol: 'AAPL',
      side: 'BUY',
      quantity: '-1',
      fee: '1',
      idempotencyKey: 'one',
    }).success,
    false,
  );
  assert.equal(
    actionSchema.safeParse({
      action: 'portfolio.create',
      name: 'Paper',
      source: 'LIVE',
      startingCash: '10000',
    }).success,
    false,
  );
});

test('cash movements between market observations are removed from the next return', () => {
  const points = portfolioHistory(
    [],
    [
      { date: '2026-01-02', kind: 'DEPOSIT', amount: '100' },
      { date: '2026-01-03', kind: 'DEPOSIT', amount: '50' },
    ],
    [
      { symbol: 'SPY', date: '2026-01-02', close: '100' },
      { symbol: 'SPY', date: '2026-01-05', close: '101' },
    ],
    'SPY',
    '2026-01-05',
  );
  assert.equal(points.at(-1)!.equity, '150.00000000');
  assert.equal(points.at(-1)!.dailyReturn, 0);
  assert.equal(points.at(-1)!.index, 100);
});

test('CSV reports retain numeric losses and neutralize spreadsheet formulas', () => {
  assert.equal(csvCell('-12.34'), '"-12.34"');
  assert.equal(csvCell('\t=SUM(A1)'), '"\'\t=SUM(A1)"');
  assert.equal(csvCell('a"b'), '"a""b"');
});
