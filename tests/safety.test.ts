import "./setup";
import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import { accessKey, keyMatches, rotateKey } from "../app/lib/access";
import {
  getFile,
  getFileStream,
  putFile,
  deleteFiles,
} from "../app/lib/storage";
import { HttpError } from "../app/lib/errors";
import { ingestPdf } from "../app/lib/ingest";
import * as db from "../app/lib/repo";
import { makePdf } from "./pdf";

test("PDF保存に失敗したら版を残さず、再送で保存できる", async () => {
  const dir = process.env.FILES_DIR!;
  const unavailable = path.join(dir, "not-a-directory");
  await fs.writeFile(unavailable, "file");
  const document = await db.createDocument({
    title: "Storage test",
    normalizedTitle: "storage-test",
  });
  const input = {
    documentId: document.id,
    buffer: makePdf(["Storage test"]),
    filename: "storage.pdf",
  };
  try {
    process.env.FILES_DIR = unavailable;
    await assert.rejects(ingestPdf(input));
    assert.equal(await db.latestVersion(document.id), undefined);
  } finally {
    process.env.FILES_DIR = dir;
    await fs.rm(unavailable);
  }
  const saved = await ingestPdf(input);
  assert.equal(saved.version.number, 1);
  assert.ok(await getFile(`pdfs/${saved.version.id}.pdf`));
});

test("保存先外への読み書き・削除を拒否する", async () => {
  const filename = path.join(
    process.env.FILES_DIR!,
    "../revi-outside-test.txt",
  );
  await fs.writeFile(filename, "keep");
  try {
    for (const key of [
      "uploads/../../revi-outside-test.txt",
      "../revi-outside-test.txt",
      "/tmp/example",
      "uploads/../secret",
      "uploads/..\\secret",
      "uploads/\0secret",
    ]) {
      await assert.rejects(getFile(key), HttpError);
      await assert.rejects(putFile(key, Buffer.from("overwrite")), HttpError);
      await assert.rejects(deleteFiles([key]), HttpError);
    }
    assert.equal(await fs.readFile(filename, "utf8"), "keep");
    await putFile("pdfs/test.pdf", Buffer.from("pdf"));
    assert.equal((await getFile("pdfs/test.pdf"))?.toString(), "pdf");
    await deleteFiles(["pdfs/test.pdf"]);
    assert.equal(await getFile("pdfs/test.pdf"), undefined);
  } finally {
    await fs.rm(filename, { force: true });
  }
});

test("初回の同時アクセスでも鍵は一つ。更新後は古い鍵を拒否する", async () => {
  const keys = await Promise.all(Array.from({ length: 8 }, () => accessKey()));
  assert.equal(new Set(keys).size, 1);
  assert.equal(await keyMatches(keys[0]), true);
  const next = await rotateKey();
  assert.notEqual(next, keys[0]);
  assert.equal(await keyMatches(keys[0]), false);
  assert.equal(await keyMatches(next), true);
});

test("大きいファイルを分割して配信し、欠落なく読み取れる", async () => {
  const buffer = Buffer.alloc(6 * 1024 * 1024, 123);
  await putFile("pdfs/large.pdf", buffer);
  const stream = await getFileStream("pdfs/large.pdf");
  assert.ok(stream);
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  assert.ok(chunks.length > 1);
  assert.deepEqual(Buffer.concat(chunks), buffer);
  assert.equal(await getFileStream("pdfs/missing.pdf"), undefined);
  await assert.rejects(getFileStream("../outside"), HttpError);
  await deleteFiles(["pdfs/large.pdf"]);
});

test("VercelでBlob設定が欠けていたらローカル保存へ切り替えない", async () => {
  const before = process.env.VERCEL;
  process.env.VERCEL = "1";
  try {
    await assert.rejects(
      putFile("pdfs/production.pdf", Buffer.from("pdf")),
      /BLOB_READ_WRITE_TOKEN/,
    );
    await assert.rejects(
      getFile("pdfs/production.pdf"),
      /BLOB_READ_WRITE_TOKEN/,
    );
  } finally {
    if (before === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = before;
  }
});

test("同じ新規PDFを同時登録しても資料と版は一つ", async () => {
  const input = {
    buffer: makePdf(["Concurrent new document", "unique registration"]),
    filename: "concurrent-new.pdf",
    uploadedBy: "Concurrent Author",
  };
  const before = (await db.documentsIn()).length;
  const results = await Promise.all(
    Array.from({ length: 8 }, () => ingestPdf(input)),
  );
  assert.equal(new Set(results.map((r) => r.document.id)).size, 1);
  assert.equal(new Set(results.map((r) => r.version.id)).size, 1);
  assert.equal(results.filter((r) => !r.duplicate).length, 1);
  assert.equal((await db.documentsIn()).length, before + 1);
  assert.equal((await db.listVersions(results[0].document.id)).length, 1);
  assert.deepEqual(
    await getFile(`pdfs/${results[0].version.id}.pdf`),
    input.buffer,
  );
});

test("新規PDFの保存失敗では空の資料も残さない", async () => {
  const dir = process.env.FILES_DIR!;
  const unavailable = path.join(dir, "new-not-a-directory");
  await fs.writeFile(unavailable, "file");
  const before = (await db.documentsIn()).length;
  const input = {
    buffer: makePdf(["New storage failure"]),
    filename: "new-storage.pdf",
  };
  try {
    process.env.FILES_DIR = unavailable;
    await assert.rejects(ingestPdf(input));
    assert.equal((await db.documentsIn()).length, before);
  } finally {
    process.env.FILES_DIR = dir;
    await fs.rm(unavailable);
  }
  const saved = await ingestPdf(input);
  assert.equal(saved.version.number, 1);
  assert.ok(await getFile(`pdfs/${saved.version.id}.pdf`));
});
