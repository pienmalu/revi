// 空のローカルDBに、画面の操作を試せる架空の資料を3件だけ作る。
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { ingestPdf } from "../app/lib/ingest";
import * as repo from "../app/lib/repo";
import { reportSubmission } from "../app/lib/workflow";
import { setDocumentTitle } from "../app/lib/document-actions";

if (
  process.env.DATABASE_URL ||
  process.env.BLOB_READ_WRITE_TOKEN ||
  process.env.PGLITE_DIR ||
  process.env.FILES_DIR
) {
  throw new Error("サンプルは既定のローカル保存先にだけ作成できます");
}

const today = new Date();
const deadline = new Date(today.getTime() + 14 * 86_400_000)
  .toISOString()
  .slice(0, 10);

async function samplePdf(
  title: string,
  lines: string[],
  landscape = false,
): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage(landscape ? [842, 595] : [595, 842]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  page.drawText(title, {
    x: 50,
    y: page.getHeight() - 70,
    size: landscape ? 28 : 20,
    font,
    color: rgb(0.13, 0.16, 0.2),
  });
  lines.forEach((line, index) => {
    page.drawText(line, {
      x: 50,
      y: page.getHeight() - 115 - index * (landscape ? 36 : 25),
      size: landscape ? 16 : 11,
      font,
    });
  });
  return Buffer.from(await pdf.save());
}

async function main() {
  if ((await repo.listDocuments()).length || (await repo.listPeople()).length) {
    throw new Error(
      "既存の資料やメンバーがあります。サンプルは空のDBにだけ作成できます",
    );
  }

  const lead = await repo.createPerson({ name: "見本 花" });
  const reviewer = await repo.createPerson({ name: "見本 太郎" });
  await repo.setPersonNameEn(lead.id, "Hana Mihon");
  await repo.setPersonNameEn(reviewer.id, "Taro Mihon");

  const draft = await ingestPdf({
    buffer: await samplePdf("Sample Paper: First Draft", [
      "This is a fictional paper for trying the review screen.",
      "The first draft leaves the experiment description unfinished.",
      "A coauthor can leave comments on text or on the whole paper.",
    ]),
    filename: "sample-paper-v1.pdf",
    uploadedBy: lead.name,
    uploaderId: lead.id,
  });
  const draftId = draft.document.id;
  await setDocumentTitle(draftId, "【サンプル】添削中の論文");
  await repo.setAuthors(draftId, [lead.id, reviewer.id], true);
  await repo.updatePaper(draftId, {
    venue: "架空の研究会",
    deadline,
    note: "最新版を開き、コメント、返信、確認OKを試せます。",
  });
  const oldComment = await repo.createComment({
    versionId: draft.version.id,
    author: reviewer.name,
    kind: "general",
    body: "実験条件を一文追加してください。",
  });
  await repo.updateComment(oldComment.id, { status: "resolved" });
  const revised = await ingestPdf({
    buffer: await samplePdf("Sample Paper: Revised Draft", [
      "This is the second version of the fictional paper.",
      "The experiment now compares two conditions under the same setup.",
      "The conclusion still needs a clearer explanation of the limits.",
    ]),
    filename: "sample-paper-v2.pdf",
    uploadedBy: lead.name,
    uploaderId: lead.id,
    documentId: draftId,
    force: true,
  });
  const comment = await repo.createComment({
    versionId: revised.version.id,
    author: reviewer.name,
    kind: "general",
    body: "結論に、比較できなかった条件も書いてください。",
  });
  await repo.createComment({
    versionId: revised.version.id,
    parentId: comment.id,
    author: lead.name,
    body: "了解しました。次の版で追記します。",
  });

  const submitted = await ingestPdf({
    buffer: await samplePdf("Sample Paper: Submitted", [
      "This fictional paper has completed coauthor review.",
      "Its submission receipt and publication fields are examples.",
    ]),
    filename: "submitted-paper.pdf",
    uploadedBy: lead.name,
    uploaderId: lead.id,
  });
  await setDocumentTitle(submitted.document.id, "【サンプル】提出済みの論文");
  await repo.setAuthors(submitted.document.id, [lead.id, reviewer.id], true);
  await repo.updatePaper(submitted.document.id, {
    venue: "架空の研究会",
    published_month: today.toISOString().slice(0, 7),
    pages: "1-4",
    note: "提出報告と業績の表示を確認するための架空の資料です。",
  });
  await repo.setApproval(submitted.version.id, reviewer.id);
  await reportSubmission({
    documentId: submitted.document.id,
    by: lead.name,
    receipt: {
      buffer: Buffer.from(
        "From: sample@example.invalid\nSubject: Sample submission receipt\n\nThis is a fictional receipt.\n",
      ),
      filename: "sample-receipt.eml",
      contentType: "message/rfc822",
    },
  });

  const slides = await ingestPdf({
    buffer: await samplePdf(
      "Sample Slides: Research Update",
      [
        "1. Background and question",
        "2. Method and preliminary result",
        "3. Points for discussion",
      ],
      true,
    ),
    filename: "sample-slides.pdf",
    uploadedBy: lead.name,
    uploaderId: lead.id,
  });
  await setDocumentTitle(slides.document.id, "【サンプル】発表スライド");
  await repo.setAuthors(slides.document.id, [lead.id], true);
  await repo.createComment({
    versionId: slides.version.id,
    author: reviewer.name,
    kind: "general",
    body: "結果の図を一枚追加すると伝わりやすくなります。",
  });

  console.log("架空の資料を3件作成しました：添削中、提出済み、スライド");
}

await main();
