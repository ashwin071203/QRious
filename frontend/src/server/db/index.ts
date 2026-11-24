import "server-only";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export type DB = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];
export type Executor = DB | Tx;

const g = globalThis as unknown as { __qriousPool?: Pool; __qriousDb?: DB };

function connectionString(): string {
  const cs = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
  if (!cs) throw new Error("DATABASE_URL is not configured.");
  return cs;
}

/** One pool per serverless instance; small because Neon's pooler multiplexes connections. */
export function getDb(): DB {
  if (!g.__qriousDb) {
    g.__qriousPool = new Pool({
      connectionString: connectionString(),
      max: Number(process.env.DB_POOL_MAX ?? 5),
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 10_000,
    });
    g.__qriousDb = drizzle(g.__qriousPool, { schema });
  }
  return g.__qriousDb;
}

export { schema };
