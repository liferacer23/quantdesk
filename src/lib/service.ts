import { Prisma } from '@prisma/client';
import { db } from './db';
import { D, fixed, tradeMath, portfolioHistory, riskMetrics, rebalancePlan } from './finance';
import { ensureSimulated, refreshMarket } from './market';
import { HttpError } from './http';
import type { Action } from './validation';
export async function ownedPortfolio(workspaceId: string, id: string) {
  const p = await db.portfolio.findFirst({ where: { id, workspaceId } });
  if (!p) throw new HttpError(404, 'Portfolio not found.');
  return p;
}
interface QuoteRow {
  symbol: string;
  name: string;
  sector: string;
  assetClass: string;
  date: Date;
  close: Prisma.Decimal;
  open: Prisma.Decimal;
  high: Prisma.Decimal;
  low: Prisma.Decimal;
  volume: bigint;
  fetchedAt: Date;
  priorClose: Prisma.Decimal | null;
}
export async function lastQuotes(source: string) {
  const rows = await db.$queryRaw<
    QuoteRow[]
  >`WITH latest AS (SELECT DISTINCT ON (symbol) * FROM "Candle" WHERE source=${source} ORDER BY symbol,date DESC) SELECT c.*,i.name,i.sector,i."assetClass",previous.close AS "priorClose" FROM latest c JOIN "Instrument" i ON i.symbol=c.symbol LEFT JOIN LATERAL (SELECT close FROM "Candle" p WHERE p.symbol=c.symbol AND p.source=c.source AND p.date<c.date ORDER BY p.date DESC LIMIT 1) previous ON true`;
  return rows.map((r) => ({
    symbol: r.symbol,
    name: r.name,
    sector: r.sector,
    assetClass: r.assetClass,
    source,
    date: r.date.toISOString().slice(0, 10),
    close: r.close.toFixed(8),
    change: r.priorClose ? fixed(D(r.close.toString()).minus(r.priorClose.toString())) : null,
    changePct: r.priorClose
      ? D(r.close.toString()).div(r.priorClose.toString()).minus(1).toNumber()
      : null,
    open: r.open.toFixed(8),
    high: r.high.toFixed(8),
    low: r.low.toFixed(8),
    volume: r.volume.toString(),
    fetchedAt: r.fetchedAt.toISOString(),
    stale: Date.now() - +r.date > 7 * 86400000,
  }));
}
export interface TradeInput {
  symbol: string;
  side: 'BUY' | 'SELL';
  quantity: string;
  fee: string;
  idempotencyKey: string;
}
export async function recordTrade(
  tx: Prisma.TransactionClient,
  portfolioId: string,
  input: TradeInput,
  executedAt = new Date(),
) {
  await tx.$queryRaw`SELECT id FROM "Portfolio" WHERE id=${portfolioId} FOR UPDATE`;
  const p = await tx.portfolio.findUniqueOrThrow({ where: { id: portfolioId } });
  const duplicate = await tx.trade.findUnique({
    where: { portfolioId_idempotencyKey: { portfolioId, idempotencyKey: input.idempotencyKey } },
  });
  if (duplicate)
    return { message: 'The original paper order was already recorded.', id: duplicate.id };
  const candle = await tx.candle.findFirst({
    where: { symbol: input.symbol, source: p.source, date: { lte: executedAt } },
    orderBy: { date: 'desc' },
  });
  if (!candle)
    throw new HttpError(
      409,
      'No price is available for this symbol in the portfolio’s data source.',
    );
  if (+executedAt - +candle.date > 7 * 86400000)
    throw new HttpError(
      409,
      'The latest observation is too old for a paper fill. Refresh market data first.',
    );
  const holding = await tx.position.findUnique({
    where: { portfolioId_symbol: { portfolioId, symbol: input.symbol } },
  });
  let math: ReturnType<typeof tradeMath>;
  try {
    math = tradeMath({
      side: input.side,
      quantity: input.quantity,
      price: candle.close.toString(),
      fee: input.fee,
      cash: p.cash.toString(),
      holding: {
        quantity: holding?.quantity.toString() || '0',
        costBasis: holding?.costBasis.toString() || '0',
      },
    });
  } catch (e) {
    throw new HttpError(409, e instanceof Error ? e.message : 'Paper order rejected.');
  }
  const trade = await tx.trade.create({
    data: {
      portfolioId,
      symbol: input.symbol,
      side: input.side,
      quantity: input.quantity,
      fee: input.fee,
      price: candle.close,
      priceAsOf: candle.date,
      cashDelta: fixed(math.cashDelta),
      costBasisReleased: fixed(math.costBasisReleased),
      realizedPnl: fixed(math.realizedPnl),
      idempotencyKey: input.idempotencyKey,
      executedAt,
    },
  });
  await tx.portfolio.update({
    where: { id: portfolioId },
    data: { cash: fixed(D(p.cash.toString()).plus(math.cashDelta)) },
  });
  await tx.position.upsert({
    where: { portfolioId_symbol: { portfolioId, symbol: input.symbol } },
    create: {
      portfolioId,
      symbol: input.symbol,
      quantity: fixed(math.quantity),
      costBasis: fixed(math.costBasis),
    },
    update: { quantity: fixed(math.quantity), costBasis: fixed(math.costBasis) },
  });
  await tx.audit.create({
    data: {
      workspaceId: p.workspaceId,
      action: 'paper.trade',
      detail: `${input.side} ${input.quantity} ${input.symbol} at ${p.source.toLowerCase()} observed daily close (${candle.date.toISOString().slice(0, 10)}). No broker order sent.`,
    },
  });
  return {
    message: 'Paper order recorded at the last observed daily close. No real trade was placed.',
    id: trade.id,
  };
}
export async function executeTrade(
  portfolioId: string,
  input: TradeInput,
  executedAt = new Date(),
) {
  return db.$transaction((tx) => recordTrade(tx, portfolioId, input, executedAt));
}
export async function dataFor(workspaceId: string, selectedId?: string, range = 180) {
  await ensureSimulated();
  const [workspace, portfolios, watchlists, audits] = await Promise.all([
    db.workspace.findUniqueOrThrow({
      where: { id: workspaceId },
      select: { id: true, name: true, demo: true },
    }),
    db.portfolio.findMany({
      where: { workspaceId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    }),
    db.watchlist.findMany({ where: { workspaceId }, orderBy: { createdAt: 'asc' } }),
    db.audit.findMany({ where: { workspaceId }, orderBy: { createdAt: 'desc' }, take: 30 }),
  ]);
  const selected = portfolios.find((p) => p.id === selectedId) || portfolios[0];
  if (selectedId && !portfolios.some((p) => p.id === selectedId))
    throw new HttpError(404, 'Portfolio not found.');
  const source = selected?.source || 'SIMULATED';
  const [quotes, providerStates] = await Promise.all([
    lastQuotes(source),
    db.providerState.findMany({ take: 100 }),
  ]);
  const base = {
    workspace,
    portfolios: portfolios.map((p) => ({
      ...p,
      cash: p.cash.toFixed(8),
      createdAt: p.createdAt.toISOString(),
    })),
    watchlists,
    quotes,
    providerStates: providerStates.map((p) => ({
      ...p,
      lastAttemptAt: p.lastAttemptAt?.toISOString() || null,
      lastSuccessAt: p.lastSuccessAt?.toISOString() || null,
      leasedUntil: undefined,
    })),
    audits: audits.map((a) => ({ ...a, createdAt: a.createdAt.toISOString() })),
    providerConfigured: Boolean(process.env.ALPHAVANTAGE_API_KEY),
    source,
  };
  if (!selected)
    return {
      ...base,
      portfolio: null,
      positions: [],
      trades: [],
      flows: [],
      history: [],
      summary: null,
      risk: riskMetrics([]),
      truncated: false,
      unpricedSymbols: [] as string[],
    };
  const p = selected;
  const [positions, trades, flows, tradeTotals, tradeCount, flowCount] = await Promise.all([
    db.position.findMany({
      where: { portfolioId: p.id, quantity: { gt: 0 } },
      include: { instrument: true },
      orderBy: { symbol: 'asc' },
    }),
    db.trade.findMany({
      where: { portfolioId: p.id },
      orderBy: [{ executedAt: 'asc' }, { id: 'asc' }],
      take: 5000,
    }),
    db.cashFlow.findMany({
      where: { portfolioId: p.id },
      orderBy: { executedAt: 'asc' },
      take: 5000,
    }),
    db.trade.aggregate({ where: { portfolioId: p.id }, _sum: { realizedPnl: true, fee: true } }),
    db.trade.count({ where: { portfolioId: p.id } }),
    db.cashFlow.count({ where: { portfolioId: p.id } }),
  ]);
  const symbols = [...new Set([...trades.map((t) => t.symbol), p.benchmark])];
  const prices = await db.candle.findMany({
    where: {
      source: p.source,
      symbol: { in: symbols },
      date: { gte: new Date(Date.now() - 400 * 86400000) },
    },
    select: { symbol: true, date: true, close: true },
    orderBy: { date: 'asc' },
    take: 100000,
  });
  const unpricedSymbols = positions
    .filter((h) => !quotes.some((q) => q.symbol === h.symbol))
    .map((h) => h.symbol);
  const marketValue = positions.reduce((sum, h) => {
    const q = quotes.find((q) => q.symbol === h.symbol);
    return q ? sum.plus(D(h.quantity.toString()).mul(q.close)) : sum;
  }, D(0));
  const equity = unpricedSymbols.length ? null : marketValue.plus(p.cash.toString());
  const netContributed = flows.reduce(
    (sum, f) => sum.plus(D(f.amount.toString()).mul(f.kind === 'DEPOSIT' ? 1 : -1)),
    D(0),
  );
  const truncated = tradeCount > 5000 || flowCount > 5000 || prices.length === 100000;
  const historyRaw = truncated
    ? []
    : portfolioHistory(
        trades.map((t) => ({
          symbol: t.symbol,
          side: t.side,
          quantity: t.quantity.toString(),
          cashDelta: t.cashDelta.toString(),
          date: t.executedAt.toISOString().slice(0, 10),
        })),
        flows.map((f) => ({
          kind: f.kind,
          amount: f.amount.toString(),
          date: f.executedAt.toISOString().slice(0, 10),
        })),
        prices.map((c) => ({
          symbol: c.symbol,
          date: c.date.toISOString().slice(0, 10),
          close: c.close.toString(),
        })),
        p.benchmark,
        new Date().toISOString().slice(0, 10),
      );
  const since = new Date(Date.now() - range * 86400000).toISOString().slice(0, 10),
    visible = historyRaw.filter((h) => h.date >= since),
    first = visible[0];
  let peak = first?.index || 100;
  const history = visible.map((h) => {
    if (h.index !== null) peak = Math.max(peak, h.index);
    return {
      ...h,
      index: h.index !== null && first?.index ? (h.index / first.index) * 100 : null,
      benchmarkIndex:
        h.benchmarkIndex !== null && first?.benchmarkIndex
          ? (h.benchmarkIndex / first.benchmarkIndex) * 100
          : null,
      drawdown: h.index === null ? null : h.index / peak - 1,
    };
  });
  const last = history.at(-1),
    risk = riskMetrics(
      visible.slice(1).flatMap((h) => (h.dailyReturn === null ? [] : [h.dailyReturn])),
      p.riskFreeRate,
    );
  return {
    ...base,
    portfolio: { ...p, cash: p.cash.toFixed(8), createdAt: p.createdAt.toISOString() },
    positions: positions.map((h) => {
      const q = quotes.find((q) => q.symbol === h.symbol),
        value = q ? D(h.quantity.toString()).mul(q.close) : null;
      return {
        id: h.id,
        symbol: h.symbol,
        name: h.instrument.name,
        sector: h.instrument.sector,
        assetClass: h.instrument.assetClass,
        quantity: h.quantity.toFixed(6),
        costBasis: h.costBasis.toFixed(8),
        averageCost: D(h.costBasis.toString()).div(h.quantity.toString()).toFixed(8),
        price: q?.close || null,
        priceAsOf: q?.date || null,
        stale: q?.stale || false,
        value: value ? fixed(value) : null,
        unrealizedPnl: value ? fixed(value.minus(h.costBasis.toString())) : null,
        weight: value && equity && equity.gt(0) ? value.div(equity).mul(100).toNumber() : null,
      };
    }),
    trades: trades
      .slice(-100)
      .reverse()
      .map((t) => ({
        ...t,
        quantity: t.quantity.toFixed(6),
        price: t.price.toFixed(8),
        fee: t.fee.toFixed(8),
        cashDelta: t.cashDelta.toFixed(8),
        costBasisReleased: t.costBasisReleased.toFixed(8),
        realizedPnl: t.realizedPnl.toFixed(8),
        priceAsOf: t.priceAsOf.toISOString().slice(0, 10),
        executedAt: t.executedAt.toISOString(),
      })),
    flows: flows
      .slice(-50)
      .reverse()
      .map((f) => ({ ...f, amount: f.amount.toFixed(8), executedAt: f.executedAt.toISOString() })),
    history,
    summary: {
      cash: p.cash.toFixed(8),
      equity: equity ? fixed(equity) : null,
      marketValue: unpricedSymbols.length ? null : fixed(marketValue),
      netContributed: truncated ? null : fixed(netContributed),
      netPnl: equity && !truncated ? fixed(equity.minus(netContributed)) : null,
      realizedPnl: tradeTotals._sum.realizedPnl?.toFixed(8) || '0.00000000',
      unrealizedPnl: equity
        ? fixed(
            marketValue.minus(positions.reduce((sum, h) => sum.plus(h.costBasis.toString()), D(0))),
          )
        : null,
      fees: tradeTotals._sum.fee?.toFixed(8) || '0.00000000',
      periodReturn: last?.index == null ? null : last.index / 100 - 1,
      benchmarkReturn: last?.benchmarkIndex == null ? null : last.benchmarkIndex / 100 - 1,
      tradeCount,
      valuationGaps: visible.filter((h) => h.equity === null).length,
    },
    risk,
    truncated,
    unpricedSymbols,
  };
}
export type Data = Awaited<ReturnType<typeof dataFor>>;
export async function simulate(
  workspaceId: string,
  portfolioId: string,
  weights: Record<string, number>,
  fee: string,
) {
  const d = await dataFor(workspaceId, portfolioId);
  if (!d.summary?.equity || d.unpricedSymbols.length)
    throw new HttpError(409, 'Every held asset must be priced before simulating rebalancing.');
  try {
    return rebalancePlan({
      equity: d.summary.equity,
      cash: d.summary.cash,
      positions: d.positions.map((h) => ({
        symbol: h.symbol,
        quantity: h.quantity,
        value: h.value!,
      })),
      prices: Object.fromEntries(d.quotes.map((q) => [q.symbol, q.close])),
      weights,
      fee,
    });
  } catch (e) {
    throw new HttpError(400, e instanceof Error ? e.message : 'Review target weights.');
  }
}
export interface ActionResult {
  message: string;
  id?: string;
  simulation?: ReturnType<typeof rebalancePlan>;
}
export async function perform(workspaceId: string, input: Action): Promise<ActionResult> {
  if (input.action === 'market.refresh') {
    const w = await db.workspace.findUniqueOrThrow({ where: { id: workspaceId } });
    if (w.demo)
      throw new HttpError(
        403,
        'Refresh the real provider from a private workspace. The public demo remains simulated.',
      );
    return refreshMarket(input.symbol);
  }
  if (input.action === 'trade.execute') {
    await ownedPortfolio(workspaceId, input.portfolioId);
    return executeTrade(input.portfolioId, input);
  }
  if (input.action === 'rebalance.simulate')
    return {
      message: 'Paper rebalance preview calculated. No orders were placed.',
      simulation: await simulate(workspaceId, input.portfolioId, input.weights, input.fee),
    };
  if (input.action === 'rebalance.save')
    await simulate(workspaceId, input.portfolioId, input.weights, '0');
  if (input.action === 'demo.reset') {
    const w = await db.workspace.findUniqueOrThrow({ where: { id: workspaceId } });
    if (!w.demo) throw new HttpError(403, 'Private workspaces cannot be reset as demos.');
    const { seedDemo } = await import('./seed');
    await seedDemo(workspaceId, true);
    return { message: 'Your isolated demo was restored.' };
  }
  return db.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Workspace" WHERE id=${workspaceId} FOR UPDATE`;
      const portfolio = async (id: string) => {
        const p = await tx.portfolio.findFirst({ where: { id, workspaceId } });
        if (!p) throw new HttpError(404, 'Portfolio not found.');
        await tx.$queryRaw`SELECT id FROM "Portfolio" WHERE id=${id} FOR UPDATE`;
        return tx.portfolio.findUniqueOrThrow({ where: { id } });
      };
      const watchlist = async (id: string) => {
        const w = await tx.watchlist.findFirst({ where: { id, workspaceId } });
        if (!w) throw new HttpError(404, 'Watchlist not found.');
        return w;
      };
      let message = 'Change saved.',
        id: string | undefined;
      switch (input.action) {
        case 'portfolio.create': {
          if ((await tx.portfolio.count({ where: { workspaceId } })) >= 10)
            throw new HttpError(409, 'At most 10 paper portfolios per workspace.');
          if (
            input.source === 'PROVIDER' &&
            (await tx.workspace.findUniqueOrThrow({ where: { id: workspaceId } })).demo
          )
            throw new HttpError(403, 'Real provider portfolios require a private workspace.');
          if (input.source === 'PROVIDER' && !process.env.ALPHAVANTAGE_API_KEY)
            throw new HttpError(503, 'The real end-of-day provider is not configured.');
          const p = await tx.portfolio.create({
            data: {
              workspaceId,
              name: input.name,
              description: input.description,
              source: input.source,
              benchmark: input.benchmark,
              cash: input.startingCash,
              flows: {
                create: {
                  kind: 'DEPOSIT',
                  amount: input.startingCash,
                  idempotencyKey: 'initial-funds',
                },
              },
            },
          });
          id = p.id;
          message = 'Paper portfolio created with virtual funds. Its price source stays fixed.';
          break;
        }
        case 'portfolio.update': {
          await portfolio(input.id);
          await tx.portfolio.update({
            where: { id: input.id },
            data: {
              name: input.name,
              description: input.description,
              benchmark: input.benchmark,
              riskFreeRate: input.riskFreeRate,
            },
          });
          message = 'Portfolio settings saved.';
          break;
        }
        case 'portfolio.delete':
          await portfolio(input.id);
          await tx.portfolio.delete({ where: { id: input.id } });
          message = 'Paper portfolio and its ledger removed.';
          break;
        case 'cash.flow': {
          const p = await portfolio(input.portfolioId);
          if (
            await tx.cashFlow.findUnique({
              where: {
                portfolioId_idempotencyKey: {
                  portfolioId: p.id,
                  idempotencyKey: input.idempotencyKey,
                },
              },
            })
          )
            return { message: 'This cash movement was already recorded.' };
          const delta = D(input.amount).mul(input.kind === 'DEPOSIT' ? 1 : -1);
          if (D(p.cash.toString()).plus(delta).lt(0))
            throw new HttpError(409, 'Insufficient paper cash for that withdrawal.');
          await tx.cashFlow.create({
            data: {
              portfolioId: p.id,
              kind: input.kind,
              amount: input.amount,
              idempotencyKey: input.idempotencyKey,
            },
          });
          await tx.portfolio.update({
            where: { id: p.id },
            data: { cash: fixed(D(p.cash.toString()).plus(delta)) },
          });
          message = 'Virtual cash movement recorded.';
          break;
        }
        case 'watchlist.create':
          if ((await tx.watchlist.count({ where: { workspaceId } })) >= 10)
            throw new HttpError(409, 'At most 10 watchlists per workspace.');
          id = (await tx.watchlist.create({ data: { workspaceId, name: input.name, symbols: [] } }))
            .id;
          message = 'Watchlist created.';
          break;
        case 'watchlist.add': {
          const w = await watchlist(input.id);
          if (w.symbols.length >= 30) throw new HttpError(409, 'At most 30 symbols per watchlist.');
          await tx.watchlist.update({
            where: { id: w.id },
            data: { symbols: [...new Set([...w.symbols, input.symbol])] },
          });
          message = 'Symbol added to watchlist.';
          break;
        }
        case 'watchlist.remove': {
          const w = await watchlist(input.id);
          await tx.watchlist.update({
            where: { id: w.id },
            data: { symbols: w.symbols.filter((s) => s !== input.symbol) },
          });
          message = 'Symbol removed from watchlist.';
          break;
        }
        case 'watchlist.delete':
          await watchlist(input.id);
          await tx.watchlist.delete({ where: { id: input.id } });
          message = 'Watchlist removed.';
          break;
        case 'rebalance.save':
          await portfolio(input.portfolioId);
          await tx.portfolio.update({
            where: { id: input.portfolioId },
            data: { targetWeights: input.weights },
          });
          message = 'Target weights saved. No paper orders placed.';
          break;
      }
      await tx.audit.create({ data: { workspaceId, action: input.action, detail: message } });
      return { message, id };
    },
    { timeout: 15000 },
  );
}
