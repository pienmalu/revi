import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import {
  loadSnapshot,
  transfer,
  type Target,
} from "../scripts/migrate-local.ts";

async function schema(db: PGlite) {
  for (const name of ["0000_init.sql", "0001_unique_version_content.sql"])
    await db.exec(await fs.readFile(path.join("db/migrations", name), "utf8"));
}

test("snapshot imports all tables, preserves JSON and files, and safely resumes", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "revi-migration-test-"));
  const source = new PGlite(path.join(root, "pglite"));
  const dest = new PGlite();
  try {
    await schema(source);
    await schema(dest);
    const body = Buffer.from("fixture-pdf");
    const sha = createHash("sha256").update(body).digest("hex");
    await fs.mkdir(path.join(root, "files", "pdfs"), { recursive: true });
    await fs.mkdir(path.join(root, "files", "copies"), { recursive: true });
    await fs.mkdir(path.join(root, "files", "receipts"), { recursive: true });
    await fs.writeFile(path.join(root, "files", "pdfs", "v.pdf"), body);
    await fs.writeFile(path.join(root, "files", "copies", "c.pdf"), body);
    await fs.writeFile(
      path.join(root, "files", "receipts", "r.txt"),
      "receipt",
    );
    await source.exec(
      `INSERT INTO settings VALUES ('access','secret'); INSERT INTO people(id,name,created_at) VALUES ('p','人','now'); INSERT INTO documents(id,title,normalized_title,created_at,receipt_key) VALUES ('d','題名','題名','now','receipts/r.txt'); INSERT INTO person_names VALUES ('p','人','人');`,
    );
    await source.query(
      `INSERT INTO versions(id,document_id,number,filename,sha256,created_at) VALUES ('v','d',1,'paper.pdf',$1,'now')`,
      [sha],
    );
    await source.query(
      `INSERT INTO copies(id,version_id,filename,sha256,created_at) VALUES ('c','v','copy.pdf',$1,'now')`,
      [sha],
    );
    await source.exec(
      `INSERT INTO comments(id,version_id,author,body,position,created_at,updated_at,copy_id) VALUES ('comment','v','人','本文','{"page":1,"nested":{"x":2}}','now','now','c'); INSERT INTO document_authors VALUES ('d','p',0); INSERT INTO approvals VALUES ('v','p','now'); INSERT INTO reminders_sent VALUES ('d','d1','date','now');`,
    );
    await source.close();
    const snapshot = await loadSnapshot(root);
    const files = new Map<string, Buffer>();
    const target: Target = {
      query: async (sql, params) =>
        (await dest.query<Record<string, unknown>>(sql, params)).rows,
      transaction: (statements) =>
        dest.transaction(async (tx) => {
          for (const s of statements) await tx.query(s.sql, s.params);
        }),
      get: async (key) => files.get(key) ?? null,
      put: async (key, data) => {
        assert.equal(files.has(key), false);
        files.set(key, data);
      },
    };
    const originalTransaction = target.transaction;
    target.transaction = async () => {
      throw new Error("network interruption");
    };
    await assert.rejects(transfer(snapshot, target), /network interruption/);
    assert.equal(files.size, 3);
    target.transaction = originalTransaction;
    const imported = await transfer(snapshot, target);
    assert.equal(imported.uploaded, 0);
    assert.ok(
      Object.values(imported.tables).every(
        (t) => t.source === 1 && t.after === 1,
      ),
    );
    assert.equal((await transfer(snapshot, target, true)).verified, true);
    assert.equal((await transfer(snapshot, target)).uploaded, 0);
    await dest.exec("UPDATE comments SET body = 'changed'");
    await assert.rejects(
      transfer(snapshot, target),
      /neither empty nor an exact copy/,
    );
    await dest.exec("UPDATE comments SET body = '本文'");
    files.set("pdfs/v.pdf", Buffer.from("collision"));
    await assert.rejects(transfer(snapshot, target), /Blob collision/);
    await fs.writeFile(path.join(root, "files", "pdfs", "v.pdf"), "broken");
    await assert.rejects(loadSnapshot(root), /Missing or corrupt/);
  } finally {
    if (!source.closed) await source.close();
    await dest.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
