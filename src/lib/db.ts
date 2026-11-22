import { PrismaClient } from '@prisma/client';
const globalDB = globalThis as unknown as { quantdeskDB?: PrismaClient };
export const db = globalDB.quantdeskDB ?? new PrismaClient();
if (process.env.NODE_ENV !== 'production') globalDB.quantdeskDB = db;
