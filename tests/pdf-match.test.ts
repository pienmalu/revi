import "./setup";
import assert from "node:assert/strict";
import { test } from "node:test";
import * as db from "../app/lib/repo";
import { encodeFingerprint, type PdfAnalysis } from "../app/lib/analyze";
import { createPdfMatcher } from "../app/lib/pdf-match";

const fingerprint = new Uint32Array([1, 2, 3, 4]);
const analysis: PdfAnalysis = {
  title: "test",
  layout: "portrait",
  header: "",
  fingerprint,
  annotations: [],
};

test("照合は候補を一括取得し、重複する版の解析と比較を再利用する", async () => {
  const docs = await Promise.all(
    ["first", "second", "third"].map((title) =>
      db.createDocument({ title, normalizedTitle: title }),
    ),
  );
  for (const document of docs) {
    await db.addVersion({
      documentId: document.id,
      filename: "old.pdf",
      sha256: "old",
      layout: "portrait",
      fingerprint: encodeFingerprint(fingerprint),
    });
    await db.addVersion({
      documentId: document.id,
      filename: "new.pdf",
      sha256: "new",
      layout: "portrait",
      fingerprint: encodeFingerprint(fingerprint),
    });
  }
  const calls: string[][] = [];
  const analyzed: string[] = [];
  const match = createPdfMatcher(analysis, {
    versions: async (ids) => {
      calls.push(ids);
      return db.versionsForDocuments(ids);
    },
    analysis: async (version) => {
      analyzed.push(version.id);
      return version;
    },
  });
  const candidates = docs.map((d) => ({ ...d, in_thread: false }));
  const first = await match(candidates.slice(0, 2));
  assert.deepEqual(calls, [[docs[0].id, docs[1].id]]);
  assert.equal(analyzed.length, 4);
  assert.equal(first?.document.id, docs[0].id);
  assert.equal(first?.version.number, 2);
  const second = await match(
    candidates.map((d, i) => ({ ...d, in_thread: i === 1 })),
  );
  assert.deepEqual(calls, [[docs[0].id, docs[1].id], [docs[2].id]]);
  assert.equal(analyzed.length, 6);
  assert.equal(new Set(analyzed).size, 6);
  assert.equal(second?.document.id, docs[1].id);
  assert.equal(second?.version.number, 2);
  const repeated = await match(candidates);
  assert.equal(calls.length, 2);
  assert.equal(analyzed.length, 6);
  assert.equal(repeated?.document.id, docs[0].id);
});

test("本文が無いPDFでは候補の版を取得しない", async () => {
  const match = createPdfMatcher(
    { ...analysis, fingerprint: null },
    {
      versions: async () => {
        assert.fail("不要なDB取得");
      },
      analysis: async () => {
        assert.fail("不要な解析");
      },
    },
  );
  assert.equal(await match([]), undefined);
});
