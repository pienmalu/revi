// データベースへのつなぎ方。
// - DATABASE_URL が Neon（neon.tech）なら、neon-http でつなぐ（本番の Vercel）
// - 空なら、PGlite（Postgres をその場で動かす部品）を data/pglite に作る（手元での開発とテスト）
// monorepo の packages/database の getDb() と同じ使い方にしておく。

import path from "node:path";
import fs from "node:fs/promises";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema.ts";

export * from "./schema.ts";

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

const MIGRATIONS = path.join(process.cwd(), "db", "migrations");

// 開発中はファイルを直すたびに読み込み直されるので、つなぎ先を1つだけにしておく
const cache = globalThis as unknown as { __reviDb?: Promise<Db> };

async function connect(): Promise<Db> {
  const url = process.env.DATABASE_URL;
  if (process.env.VERCEL && !url)
    throw new Error("Vercel では DATABASE_URL が必要です");
  if (url) {
    const { neon } = await import("@neondatabase/serverless");
    const { drizzle } = await import("drizzle-orm/neon-http");
    return drizzle(neon(url), { schema }) as unknown as Db;
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  // テストでは PGLITE_DIR に別の場所（または "memory"）を渡し、本物のデータに触らない
  const dir =
    process.env.PGLITE_DIR ??
    path.join(/* turbopackIgnore: true */ process.cwd(), "data", "pglite");
  if (dir !== "memory") await fs.mkdir(path.dirname(dir), { recursive: true });
  const client = dir === "memory" ? new PGlite() : new PGlite(dir);
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS });
  return db as unknown as Db;
}

export function getDb(): Promise<Db> {
  cache.__reviDb ??= connect();
  return cache.__reviDb;
}
