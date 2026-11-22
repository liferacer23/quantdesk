import { db } from './db';
import { ensureSimulated } from './market';
import { recordTrade } from './service';
export async function seedDemo(workspaceId: string, reset = false) {
  await ensureSimulated();
  await db.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Workspace" WHERE id=${workspaceId} FOR UPDATE`;
      if (reset) {
        await tx.portfolio.deleteMany({ where: { workspaceId } });
        await tx.watchlist.deleteMany({ where: { workspaceId } });
        await tx.audit.deleteMany({ where: { workspaceId } });
      } else if (await tx.portfolio.count({ where: { workspaceId } })) return;
      const rows = await tx.candle.findMany({
        where: { symbol: 'SPY', source: 'SIMULATED' },
        orderBy: { date: 'desc' },
        take: 160,
      });
      const dates = rows.reverse().map((r) => r.date),
        start = dates[0];
      const growth = await tx.portfolio.create({
        data: {
          workspaceId,
          name: 'Core growth',
          description: 'Synthetic research portfolio of US equities and broad-market exposure.',
          cash: '100000',
          source: 'SIMULATED',
          benchmark: 'SPY',
          createdAt: start,
          targetWeights: { AAPL: 20, MSFT: 20, NVDA: 15, SPY: 30, CASH: 15 },
          flows: {
            create: {
              kind: 'DEPOSIT',
              amount: '100000',
              idempotencyKey: 'seed-funds',
              executedAt: start,
            },
          },
        },
      });
      const index = await tx.portfolio.create({
        data: {
          workspaceId,
          name: 'Long-horizon index',
          description: 'A separate synthetic portfolio for broad-market and fixed-income research.',
          cash: '50000',
          source: 'SIMULATED',
          benchmark: 'VTI',
          createdAt: start,
          targetWeights: { VTI: 60, BND: 25, CASH: 15 },
          flows: {
            create: {
              kind: 'DEPOSIT',
              amount: '50000',
              idempotencyKey: 'seed-funds',
              executedAt: start,
            },
          },
        },
      });
      const orders = [
        ['AAPL', 'BUY', '70', 5],
        ['MSFT', 'BUY', '45', 12],
        ['NVDA', 'BUY', '90', 20],
        ['SPY', 'BUY', '25', 35],
        ['AAPL', 'BUY', '20', 65],
        ['NVDA', 'SELL', '15', 95],
        ['MSFT', 'BUY', '10', 110],
        ['SPY', 'SELL', '5', 130],
      ] as const;
      for (const [symbol, side, quantity, day] of orders)
        await recordTrade(
          tx,
          growth.id,
          { symbol, side, quantity, fee: '1', idempotencyKey: `seed-${symbol}-${side}-${day}` },
          new Date(+dates[day] + 12 * 3600000),
        );
      for (const [symbol, quantity, day] of [
        ['VTI', '100', 15],
        ['BND', '120', 25],
      ] as const)
        await recordTrade(
          tx,
          index.id,
          { symbol, side: 'BUY', quantity, fee: '1', idempotencyKey: 'seed-' + symbol },
          new Date(+dates[day] + 12 * 3600000),
        );
      await tx.watchlist.createMany({
        data: [
          {
            workspaceId,
            name: 'Research desk',
            symbols: ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'SPY', 'QQQ'],
          },
          { workspaceId, name: 'Broad market', symbols: ['SPY', 'VTI', 'BND'] },
        ],
      });
      await tx.audit.create({
        data: {
          workspaceId,
          action: reset ? 'demo.reset' : 'demo.created',
          detail:
            'Isolated synthetic portfolios and virtual funds. All prices are fictional SIMULATED observations; no real orders or market-data claims.',
        },
      });
    },
    { timeout: 20000 },
  );
}
