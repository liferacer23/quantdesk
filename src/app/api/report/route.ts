import { csvCell as cell } from '@/lib/csv';
import { requireSession } from '@/lib/auth';
import { dataFor } from '@/lib/service';
import { failure, HttpError } from '@/lib/http';
export async function GET(req: Request) {
  try {
    const d = await dataFor(
      (await requireSession()).workspaceId,
      new URL(req.url).searchParams.get('portfolio') || undefined,
    );
    if (!d.portfolio || !d.summary) throw new HttpError(404, 'Select a portfolio first.');
    const rows: unknown[][] = [
      ['QuantDesk paper portfolio report'],
      ['Portfolio', d.portfolio.name],
      ['Data source', d.source],
      ['Generated at', new Date().toISOString()],
      ['Valuation USD', d.summary.equity],
      ['Cash USD', d.summary.cash],
      ['Realized P&L USD', d.summary.realizedPnl],
      ['Unrealized P&L USD', d.summary.unrealizedPnl],
      [],
      [
        'Symbol',
        'Quantity',
        'Observed price',
        'Price as of',
        'Value USD',
        'Cost basis USD',
        'Unrealized P&L USD',
      ],
      ...d.positions.map((h) => [
        h.symbol,
        h.quantity,
        h.price,
        h.priceAsOf,
        h.value,
        h.costBasis,
        h.unrealizedPnl,
      ]),
      [],
      [
        'Assumptions',
        'Paper simulation only. Daily unadjusted prices. No dividends, splits, tax or broker execution.',
      ],
    ];
    return new Response(rows.map((r) => r.map(cell).join(',')).join('\r\n'), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="quantdesk-paper-report.csv"',
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    return failure(e);
  }
}
