// Run against a stopped-app backup containing pglite/ and files/.
// Schema migrations are a separate prerequisite. Never point this at live data/.
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { PGlite } from "@electric-sql/pglite";

export const tables = [
  "settings",
  "people",
  "documents",
  "person_names",
  "versions",
  "copies",
  "comments",
  "document_authors",
  "approvals",
  "reminders_sent",
] as const;
type Row = Record<string, unknown>;
export type Snapshot = {
  rows: Record<string, Row[]>;
  files: { key: string; body: Buffer; sha256: string }[];
};
export type Statement = { sql: string; params: unknown[] };
export interface Target {
  query(sql: string, params?: unknown[]): Promise<Row[]>;
  transaction(statements: Statement[]): Promise<unknown>;
  get(key: string): Promise<Buffer | null>;
  put(key: string, body: Buffer): Promise<unknown>;
}
const hash = (body: Buffer) => createHash("sha256").update(body).digest("hex");
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  return JSON.stringify(value);
};
const sameRows = (a: Row[], b: Row[]) =>
  canonical(a.map(canonical).sort()) === canonical(b.map(canonical).sort());

export async function readRows(
  query: Target["query"],
): Promise<Record<string, Row[]>> {
  const found = await query(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public'",
  );
  if (
    canonical(found.map((r) => r.tablename).sort()) !==
    canonical([...tables].sort())
  )
    throw new Error(
      "Unexpected public tables: schema must match this migration tool",
    );
  const rows: Record<string, Row[]> = {};
  for (const table of tables)
    rows[table] = await query(`SELECT * FROM "${table}"`);
  return rows;
}

export async function loadSnapshot(directory: string): Promise<Snapshot> {
  const root = await fs.realpath(directory);
  const live = await fs
    .realpath(path.resolve("data"))
    .catch(() => path.resolve("data"));
  if (root === live || root.startsWith(`${live}${path.sep}`))
    throw new Error(
      "Use an independent stopped-app snapshot, never live data/",
    );
  await fs.access(path.join(root, "pglite", "PG_VERSION"));
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "revi-migrate-"));
  let client: PGlite | undefined;
  try {
    await fs.cp(path.join(root, "pglite"), path.join(temporary, "pglite"), {
      recursive: true,
    });
    client = new PGlite(path.join(temporary, "pglite"));
    const db = client;
    const rows = await readRows(
      async (sql, params) => (await db.query<Row>(sql, params)).rows,
    );
    const files: Snapshot["files"] = [];
    async function walk(relative: string) {
      for (const entry of await fs.readdir(path.join(root, "files", relative), {
        withFileTypes: true,
      })) {
        const key = relative ? `${relative}/${entry.name}` : entry.name;
        if (entry.isSymbolicLink())
          throw new Error(`Symlink forbidden: ${key}`);
        if (entry.isDirectory()) await walk(key);
        else if (entry.isFile()) {
          const body = await fs.readFile(path.join(root, "files", key));
          files.push({ key, body, sha256: hash(body) });
        } else throw new Error(`Unexpected file: ${key}`);
      }
    }
    await walk("");
    const byKey = new Map(files.map((f) => [f.key, f]));
    for (const [table, prefix] of [
      ["versions", "pdfs"],
      ["copies", "copies"],
    ]) {
      for (const row of rows[table]) {
        const file = byKey.get(`${prefix}/${row.id}.pdf`);
        if (!file || file.sha256 !== row.sha256)
          throw new Error(`Missing or corrupt ${table} file: ${row.id}`);
      }
    }
    for (const row of rows.documents)
      if (row.receipt_key && !byKey.has(String(row.receipt_key)))
        throw new Error(`Missing receipt: ${row.id}`);
    return { rows, files };
  } finally {
    await client?.close();
    await fs.rm(temporary, { recursive: true, force: true });
  }
}

export function insertStatements(snapshot: Snapshot): Statement[] {
  // Lock and recheck emptiness INSIDE the atomic transaction to catch concurrent writers.
  const statements: Statement[] = [
    {
      sql: `LOCK TABLE ${tables.map((t) => `"${t}"`).join(",")} IN EXCLUSIVE MODE`,
      params: [],
    },
    {
      sql: `DO $$ BEGIN IF ${tables.map((t) => `EXISTS (SELECT 1 FROM "${t}")`).join(" OR ")} THEN RAISE EXCEPTION 'Target must be empty'; END IF; END $$`,
      params: [],
    },
  ];
  for (const table of tables) {
    if (!snapshot.rows[table].length) continue;
    // PostgreSQL converts JSON into the actual column types, including jsonb.
    statements.push({
      sql: `INSERT INTO "${table}" SELECT * FROM json_populate_recordset(NULL::"${table}", $1::json)`,
      params: [JSON.stringify(snapshot.rows[table])],
    });
  }
  return statements;
}

export async function transfer(
  snapshot: Snapshot,
  target: Target,
  verifyOnly = false,
) {
  const before = await readRows(target.query);
  const equal = tables.every((t) => sameRows(snapshot.rows[t], before[t]));
  const empty = tables.every((t) => before[t].length === 0);
  if (!empty && !equal)
    throw new Error(
      "Target is neither empty nor an exact copy; no changes made",
    );
  if (verifyOnly && !equal) throw new Error("Database does not match snapshot");
  // Preflight all existing objects before uploading anything; never overwrite collisions.
  const missing: Snapshot["files"] = [];
  for (const file of snapshot.files) {
    const body = await target.get(file.key);
    if (body && hash(body) !== file.sha256)
      throw new Error(`Blob collision: ${file.key}`);
    if (!body) missing.push(file);
  }
  if (verifyOnly && missing.length)
    throw new Error(`Missing ${missing.length} blobs`);
  for (const file of missing) await target.put(file.key, file.body);
  for (const file of snapshot.files) {
    const body = await target.get(file.key);
    if (!body || hash(body) !== file.sha256)
      throw new Error(`Blob verification failed: ${file.key}`);
  }
  if (!equal) await target.transaction(insertStatements(snapshot));
  const after = await readRows(target.query);
  for (const table of tables)
    if (!sameRows(snapshot.rows[table], after[table]))
      throw new Error(`Database verification failed: ${table}`);
  return {
    tables: Object.fromEntries(
      tables.map((t) => [
        t,
        {
          source: snapshot.rows[t].length,
          before: before[t].length,
          after: after[t].length,
        },
      ]),
    ),
    files: snapshot.files.length,
    uploaded: missing.length,
    verified: true,
  };
}

async function main() {
  const args = process.argv.slice(2);
  if (
    args.length !== 3 ||
    args[0] !== "--snapshot" ||
    !["--inspect", "--apply", "--verify"].includes(args[2])
  )
    throw new Error(
      "Usage: node --import tsx scripts/migrate-local.ts --snapshot /absolute/backup/data --inspect|--apply|--verify",
    );
  const snapshot = await loadSnapshot(args[1]);
  if (args[2] === "--inspect") {
    console.log(
      JSON.stringify(
        {
          tables: Object.fromEntries(
            tables.map((t) => [t, snapshot.rows[t].length]),
          ),
          files: snapshot.files.length,
          bytes: snapshot.files.reduce((n, f) => n + f.body.length, 0),
        },
        null,
        2,
      ),
    );
    return;
  }
  if (!process.env.DATABASE_URL || !process.env.BLOB_READ_WRITE_TOKEN)
    throw new Error("DATABASE_URL and BLOB_READ_WRITE_TOKEN are required");
  const { neon } = await import("@neondatabase/serverless");
  const { get, put } = await import("@vercel/blob");
  const sql = neon(process.env.DATABASE_URL);
  const result = await transfer(
    snapshot,
    {
      query: async (q, params) => (await sql.query(q, params ?? [])) as Row[],
      transaction: (statements) =>
        sql.transaction(statements.map((s) => sql.query(s.sql, s.params))),
      get: async (key) => {
        const result = await get(key, { access: "private", useCache: false });
        return result?.stream
          ? Buffer.from(await new Response(result.stream).arrayBuffer())
          : null;
      },
      put: (key, body) =>
        put(key, body, {
          access: "private",
          addRandomSuffix: false,
          allowOverwrite: false,
          contentType: key.endsWith(".pdf")
            ? "application/pdf"
            : "application/octet-stream",
        }),
    },
    args[2] === "--verify",
  );
  console.log(JSON.stringify(result, null, 2));
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
)
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Migration failed");
    process.exitCode = 1;
  });
