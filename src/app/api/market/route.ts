import { requireSession } from '@/lib/auth';
import { ownedPortfolio } from '@/lib/service';
import { db } from '@/lib/db';
import { ensureSimulated } from '@/lib/market';
import { failure, json, HttpError } from '@/lib/http';
export async function GET(req: Request) {
  try {
    const s = await requireSession(),
      p = new URL(req.url).searchParams,
      symbol = p.get('symbol') || 'SPY';
    if (!/^[A-Z][A-Z0-9.-]{0,11}$/.test(symbol)) throw new HttpError(400, 'Invalid ticker symbol.');
    const portfolio = p.get('portfolio')
      ? await ownedPortfolio(s.workspaceId, p.get('portfolio')!)
      : null;
    const source = portfolio?.source || 'SIMULATED';
    if (source === 'SIMULATED') await ensureSimulated();
    const candles = await db.candle.findMany({
      where: { symbol, source },
      orderBy: { date: 'desc' },
      take: 365,
    });
    const instrument = await db.instrument.findUnique({ where: { symbol } });
    return json({
      symbol,
      name: instrument?.name || symbol,
      source,
      candles: candles.reverse().map((c) => ({
        date: c.date.toISOString().slice(0, 10),
        open: c.open.toFixed(8),
        high: c.high.toFixed(8),
        low: c.low.toFixed(8),
        close: c.close.toFixed(8),
        volume: c.volume.toString(),
      })),
    });
  } catch (e) {
    return failure(e);
  }
}
