import "./setup";
import assert from "node:assert/strict";
import { test } from "node:test";
import * as db from "../app/lib/repo";
import * as actions from "../app/lib/document-actions";
import { putFile, getFile, pdfKey, copyKey } from "../app/lib/storage";

async function fixture() {
  const document = await db.createDocument({
    title: "Original",
    normalizedTitle: "original",
  });
  const { version } = await db.addVersion({
    documentId: document.id,
    filename: "paper.pdf",
    sha256: "paper",
    title: "PDF title",
  });
  await putFile(pdfKey(version.id), Buffer.from("pdf"));
  const copy = await db.createCopy({
    versionId: version.id,
    filename: "copy.pdf",
    sha256: "copy",
  });
  await putFile(copyKey(copy.id), Buffer.from("copy"));
  await db.createComment({
    versionId: version.id,
    author: "Tester",
    body: "Imported",
    copyId: copy.id,
  });
  return { document, version, copy };
}

test("原稿削除でPDF・書き込み・受領ファイルを片づける", async () => {
  const { document, version, copy } = await fixture();
  const receipt = `receipts/${document.id}/receipt.txt`;
  await putFile(receipt, Buffer.from("receipt"));
  await db.updateDocument(document.id, { receipt_key: receipt });
  assert.equal(await actions.deleteDocument(document.id), true);
  assert.equal(await db.getDocument(document.id), undefined);
  assert.equal(await db.getVersion(version.id), undefined);
  assert.equal(await db.getCopy(copy.id), undefined);
  for (const key of [receipt, pdfKey(version.id), copyKey(copy.id)])
    assert.equal(await getFile(key), undefined);
});

test("最後の版を削除しても手入力情報は残し、未編集の原稿は消す", async () => {
  const kept = await fixture();
  await actions.setDocumentTitle(kept.document.id, "Manual title");
  assert.deepEqual(await actions.deleteVersion(kept.version.id), {
    documentDeleted: false,
  });
  assert.equal((await db.getDocument(kept.document.id))?.title, "Manual title");
  assert.equal(await getFile(pdfKey(kept.version.id)), undefined);
  assert.equal(await getFile(copyKey(kept.copy.id)), undefined);
  const removed = await fixture();
  assert.deepEqual(await actions.deleteVersion(removed.version.id), {
    documentDeleted: true,
  });
  assert.equal(await db.getDocument(removed.document.id), undefined);
});

test("移動・分離は版とコメントとファイルを維持し、手入力の題名を上書きしない", async () => {
  const from = await fixture();
  const to = await db.createDocument({
    title: "Destination",
    normalizedTitle: "destination",
  });
  await actions.setDocumentTitle(to.id, "Manual destination");
  const moved = await actions.moveVersion(from.version.id, to.id);
  assert.equal(moved?.document_id, to.id);
  assert.equal(await db.getDocument(from.document.id), undefined);
  assert.equal((await db.getDocument(to.id))?.title, "Manual destination");
  const split = await actions.splitVersion(from.version.id);
  assert.notEqual(split?.document_id, to.id);
  assert.equal((await db.getDocument(to.id))?.title, "Manual destination");
  assert.equal((await db.listComments(from.version.id)).length, 1);
  assert.ok(await getFile(pdfKey(from.version.id)));
  assert.ok(await getFile(copyKey(from.copy.id)));
  await actions.deleteCopy(from.copy.id);
  assert.deepEqual(await db.listComments(from.version.id), []);
  assert.equal(await getFile(copyKey(from.copy.id)), undefined);
  assert.ok(await getFile(pdfKey(from.version.id)));
});
