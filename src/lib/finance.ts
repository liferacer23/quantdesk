import Decimal from 'decimal.js';
Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
export const D = (value: Decimal.Value) => {
  const d = new Decimal(value);
  if (!d.isFinite()) throw new Error('A finite financial value is required.');
  return d;
};
export const fixed = (value: Decimal.Value) => D(value).toDecimalPlaces(8).toFixed(8);
export interface Holding {
  quantity: Decimal.Value;
  costBasis: Decimal.Value;
}
export function tradeMath(input: {
  side: 'BUY' | 'SELL';
  quantity: Decimal.Value;
  price: Decimal.Value;
  fee: Decimal.Value;
  cash: Decimal.Value;
  holding: Holding;
}) {
  const quantity = D(input.quantity),
    price = D(input.price),
    fee = D(input.fee),
    cash = D(input.cash),
    held = D(input.holding.quantity),
    basis = D(input.holding.costBasis);
  if (quantity.lte(0) || price.lte(0) || fee.lt(0))
    throw new Error('Quantity/price must be positive and fees nonnegative.');
  const gross = quantity.mul(price).toDecimalPlaces(8);
  if (input.side === 'BUY') {
    const cost = gross.plus(fee).toDecimalPlaces(8);
    if (cost.gt(cash)) throw new Error('Insufficient paper cash, including fees.');
    return {
      quantity: held.plus(quantity),
      costBasis: basis.plus(cost),
      cashDelta: cost.neg(),
      costBasisReleased: D(0),
      realizedPnl: D(0),
    };
  }
  if (quantity.gt(held)) throw new Error('The sell quantity exceeds this paper position.');
  const released = quantity.eq(held) ? basis : basis.mul(quantity).div(held).toDecimalPlaces(8);
  const proceeds = gross.minus(fee).toDecimalPlaces(8);
  if (cash.plus(proceeds).lt(0)) throw new Error('Paper cash cannot cover the trading fee.');
  return {
    quantity: held.minus(quantity),
    costBasis: basis.minus(released),
    cashDelta: proceeds,
    costBasisReleased: released,
    realizedPnl: proceeds.minus(released),
  };
}
export function riskMetrics(returns: number[], riskFreeRate = 0.03) {
  const valid = returns.filter(Number.isFinite),
    n = valid.length;
  if (n < 2)
    return {
      samples: n,
      annualizedReturn: null,
      volatility: null,
      sharpe: null,
      maxDrawdown: null,
      bestDay: null,
      worstDay: null,
    };
  const mean = valid.reduce((a, b) => a + b, 0) / n,
    variance = valid.reduce((sum, r) => sum + (r - mean) ** 2, 0) / (n - 1),
    sd = Math.sqrt(variance),
    dailyRf = (1 + riskFreeRate) ** (1 / 252) - 1;
  let growth = 1,
    peak = 1,
    maxDrawdown = 0;
  for (const r of valid) {
    growth *= 1 + r;
    peak = Math.max(peak, growth);
    maxDrawdown = Math.min(maxDrawdown, growth / peak - 1);
  }
  return {
    samples: n,
    annualizedReturn: growth > 0 ? growth ** (252 / n) - 1 : null,
    volatility: sd * Math.sqrt(252),
    sharpe: sd > 1e-12 ? ((mean - dailyRf) / sd) * Math.sqrt(252) : null,
    maxDrawdown,
    bestDay: Math.max(...valid),
    worstDay: Math.min(...valid),
  };
}
export interface PricePoint {
  symbol: string;
  date: string;
  close: string;
}
export interface HistoryTrade {
  symbol: string;
  side: string;
  quantity: string;
  cashDelta: string;
  date: string;
}
export interface HistoryFlow {
  kind: string;
  amount: string;
  date: string;
}
export function portfolioHistory(
  trades: HistoryTrade[],
  flows: HistoryFlow[],
  prices: PricePoint[],
  benchmark: string,
  today: string,
) {
  const first = [...trades.map((t) => t.date), ...flows.map((f) => f.date)].sort()[0];
  if (!first) return [];
  const days = [
    ...new Set([
      ...prices.map((p) => p.date).filter((d) => d >= first && d <= today),
      first,
      today,
    ]),
  ].sort();
  const bySymbol = new Map<string, PricePoint[]>();
  for (const p of prices) {
    if (!bySymbol.has(p.symbol)) bySymbol.set(p.symbol, []);
    bySymbol.get(p.symbol)!.push(p);
  }
  for (const rows of bySymbol.values()) rows.sort((a, b) => a.date.localeCompare(b.date));
  const priceAt = (symbol: string, day: string) =>
    bySymbol.get(symbol)?.findLast((p) => p.date <= day)?.close;
  let priorEquity: Decimal | null = null,
    index: number | null = 100,
    benchmarkBase: string | undefined,
    peak = 100,
    previousDay = '';
  return days.map((day) => {
    let cash = D(0),
      external = D(0);
    const positions = new Map<string, Decimal>();
    for (const f of flows)
      if (f.date <= day) {
        const amount = D(f.amount).mul(f.kind === 'DEPOSIT' ? 1 : -1);
        cash = cash.plus(amount);
        if (f.date > previousDay) external = external.plus(amount);
      }
    for (const t of trades)
      if (t.date <= day) {
        cash = cash.plus(t.cashDelta);
        positions.set(
          t.symbol,
          (positions.get(t.symbol) || D(0)).plus(D(t.quantity).mul(t.side === 'BUY' ? 1 : -1)),
        );
      }
    let equity: Decimal | null = cash;
    for (const [symbol, quantity] of positions) {
      if (quantity.isZero()) continue;
      const price = priceAt(symbol, day);
      if (!price) {
        equity = null;
        break;
      }
      equity = equity!.plus(quantity.mul(price));
    }
    const dailyReturn =
      equity && priorEquity && priorEquity.gt(0)
        ? equity.minus(external).div(priorEquity).minus(1).toNumber()
        : null;
    if (equity === null) index = null;
    else if (dailyReturn !== null && index !== null) index *= 1 + dailyReturn;
    if (index !== null) peak = Math.max(peak, index);
    const benchmarkPrice = priceAt(benchmark, day);
    if (!benchmarkBase && benchmarkPrice) benchmarkBase = benchmarkPrice;
    const benchmarkIndex =
      benchmarkBase && benchmarkPrice
        ? D(benchmarkPrice).div(benchmarkBase).mul(100).toNumber()
        : null;
    const point = {
      date: day,
      equity: equity ? fixed(equity) : null,
      index,
      benchmarkIndex,
      dailyReturn,
      drawdown: index === null ? null : index / peak - 1,
      netExternalFlow: fixed(external),
    };
    priorEquity = equity;
    previousDay = day;
    return point;
  });
}
export function rebalancePlan(input: {
  equity: string;
  cash: string;
  positions: { symbol: string; quantity: string; value: string }[];
  prices: Record<string, string>;
  weights: Record<string, number>;
  fee: string;
}) {
  const total = Object.values(input.weights).reduce((a, b) => a + b, 0);
  if (Math.abs(total - 100) > 0.00001)
    throw new Error('Target weights must total 100%, including CASH.');
  if (Object.values(input.weights).some((w) => !Number.isFinite(w) || w < 0 || w > 100))
    throw new Error('Each target weight must be between 0 and 100%.');
  const equity = D(input.equity),
    fee = D(input.fee);
  if (equity.lte(0)) throw new Error('A positive, fully priced portfolio is required.');
  const symbols = [
    ...new Set([
      ...input.positions.map((p) => p.symbol),
      ...Object.keys(input.weights).filter((s) => s !== 'CASH'),
    ]),
  ];
  const rows = symbols.map((symbol) => {
    const price = input.prices[symbol];
    if (!price) throw new Error('A selected target has no price in this portfolio data source.');
    const current = input.positions.find((p) => p.symbol === symbol);
    const targetValue = equity.mul(input.weights[symbol] || 0).div(100);
    const targetQuantity = targetValue.div(price).toDecimalPlaces(6, Decimal.ROUND_DOWN);
    const quantity = targetQuantity.minus(current?.quantity || 0);
    const amount = quantity.mul(price).toDecimalPlaces(8);
    return {
      symbol,
      currentWeight: D(current?.value || 0)
        .div(equity)
        .mul(100)
        .toNumber(),
      targetWeight: input.weights[symbol] || 0,
      side: quantity.gt(0) ? 'BUY' : quantity.lt(0) ? 'SELL' : 'HOLD',
      quantity: quantity.abs().toFixed(6),
      notional: amount.abs().toFixed(8),
      cashDelta: amount
        .neg()
        .minus(quantity.isZero() ? 0 : fee)
        .toFixed(8),
    };
  });
  const estimatedCash = rows.reduce((sum, r) => sum.plus(r.cashDelta), D(input.cash));
  return {
    rows,
    estimatedCash: fixed(estimatedCash),
    estimatedFees: fixed(fee.mul(rows.filter((r) => r.side !== 'HOLD').length)),
    turnover: rows
      .reduce((sum, r) => sum.plus(r.notional), D(0))
      .div(equity)
      .div(2)
      .toNumber(),
    feasible: estimatedCash.gte(0),
    cashTarget: input.weights.CASH || 0,
  };
}
