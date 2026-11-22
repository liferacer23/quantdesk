import { z } from 'zod';
const id = z.string().min(1).max(100),
  symbol = z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z][A-Z0-9.-]{0,11}$/);
const amount = z
  .string()
  .regex(/^\d{1,9}(\.\d{1,2})?$/, 'Use a positive amount with at most two decimal places.')
  .refine(
    (v) => Number(v) > 0 && Number(v) <= 100000000,
    'Amount must be positive and at most 100 million.',
  );
export const source = z.enum(['SIMULATED', 'PROVIDER']);
export const actionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('portfolio.create'),
    name: z.string().trim().min(2).max(80),
    description: z.string().trim().max(500).default(''),
    source,
    startingCash: amount,
    benchmark: symbol.default('SPY'),
  }),
  z.object({
    action: z.literal('portfolio.update'),
    id,
    name: z.string().trim().min(2).max(80),
    description: z.string().max(500),
    benchmark: symbol,
    riskFreeRate: z.number().min(0).max(0.2),
  }),
  z.object({ action: z.literal('portfolio.delete'), id }),
  z.object({
    action: z.literal('cash.flow'),
    portfolioId: id,
    kind: z.enum(['DEPOSIT', 'WITHDRAW']),
    amount,
    idempotencyKey: z.string().min(1).max(100),
  }),
  z.object({
    action: z.literal('trade.execute'),
    portfolioId: id,
    symbol,
    side: z.enum(['BUY', 'SELL']),
    quantity: z
      .string()
      .regex(/^\d{1,7}(\.\d{1,6})?$/)
      .refine(
        (v) => Number(v) > 0 && Number(v) <= 1000000,
        'Quantity must be positive and at most one million.',
      ),
    fee: z.string().regex(/^\d{1,4}(\.\d{1,2})?$/),
    idempotencyKey: z.string().min(1).max(100),
  }),
  z.object({ action: z.literal('watchlist.create'), name: z.string().trim().min(2).max(80) }),
  z.object({ action: z.literal('watchlist.add'), id, symbol }),
  z.object({ action: z.literal('watchlist.remove'), id, symbol }),
  z.object({ action: z.literal('watchlist.delete'), id }),
  z.object({ action: z.literal('market.refresh'), symbol }),
  z.object({
    action: z.literal('rebalance.simulate'),
    portfolioId: id,
    weights: z.record(symbol, z.number().min(0).max(100)),
    fee: z.string().regex(/^\d{1,4}(\.\d{1,2})?$/),
  }),
  z.object({
    action: z.literal('rebalance.save'),
    portfolioId: id,
    weights: z.record(symbol, z.number().min(0).max(100)),
  }),
  z.object({ action: z.literal('demo.reset') }),
]);
export type Action = z.infer<typeof actionSchema>;
