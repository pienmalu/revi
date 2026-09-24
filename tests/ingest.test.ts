// PDF の登録：どの原稿の何版目か、書き込みPDF、著者の自動入力
import "./setup";
import * as documentActions from "../app/lib/document-actions";
import assert from "node:assert/strict";
import { test } from "node:test";
import { ingestPdf } from "../app/lib/ingest";
import * as db from "../app/lib/repo";
import { copyKey, getFile } from "../app/lib/storage";
import { annotate, makePdf, paper, revise } from "./pdf";

let n = 0;
const slack = (threadTs?: string, messageTs = `T${++n}`) => ({
  channel: "C1",
  threadTs,
  messageTs,
  fileId: `F${++n}`,
});

test("版の見分け", async (t) => {
  const A = ["Anchored Feedback for Lab Paper Drafts", ...paper(200)];
  const a1 = await ingestPdf({
    buffer: makePdf(A),
    filename: "ICTSSL_tanaka_v1.pdf",
    uploadedBy: "田中",
    slack: slack(undefined, "T1"),
  });
  const A2 = [
    "Anchored Comments for Collaborative Drafts",
    ...revise(A.slice(1), 0.2),
  ];
  const A3 = [A2[0], ...revise(A2.slice(1), 0.45)];
  const B = ["A Different Study", ...paper(200)];

  await t.test("題名は PDF から読む", () => {
    assert.equal(a1.document.title, "Anchored Feedback for Lab Paper Drafts");
  });

  await t.test(
    "ファイル名も題名も変えた2割修正版は、同じ原稿の v2",
    async () => {
      const a2 = await ingestPdf({
        buffer: makePdf(A2),
        filename: "全然ちがう名前.pdf",
        uploadedBy: "田中",
        slack: slack(undefined, "T2"),
      });
      assert.equal(a2.document.id, a1.document.id);
      assert.equal(a2.version.number, 2);
      assert.equal(
        a2.document.title,
        "Anchored Comments for Collaborative Drafts",
      );
    },
  );

  await t.test("スレッドでの大幅修正（45%）も次の版", async () => {
    const a3 = await ingestPdf({
      buffer: makePdf(A3),
      filename: "x.pdf",
      uploadedBy: "田中",
      slack: slack("T1"),
    });
    assert.equal(a3.document.id, a1.document.id);
    assert.equal(a3.version.number, 3);
  });

  let b1: Awaited<ReturnType<typeof ingestPdf>>;
  await t.test("同じ人・同じファイル名でも本文が違えば別の原稿", async () => {
    b1 = await ingestPdf({
      buffer: makePdf(B),
      filename: "ICTSSL_tanaka_v1.pdf",
      uploadedBy: "田中",
      slack: slack(undefined, "T3"),
    });
    assert.ok(b1.isNewDocument && !b1.suggestion);
  });

  let j1: Awaited<ReturnType<typeof ingestPdf>>;
  await t.test(
    "6割を書き換えた版は新しい原稿にして「版ですか？」と聞く",
    async () => {
      const J = ["Rewritten Paper", ...revise(A3.slice(1), 0.6)];
      j1 = await ingestPdf({
        buffer: makePdf(J),
        filename: "journal.pdf",
        uploadedBy: "田中",
        slack: slack(undefined, "T4"),
      });
      assert.ok(j1.isNewDocument);
      assert.equal(j1.suggestion?.id, a1.document.id);
    },
  );

  await t.test(
    "本文が同じで書き込みの無い PDF を共著者が送ると、版にしない",
    async () => {
      const extra = Buffer.concat([makePdf(A3), Buffer.from("\n% by sato\n")]);
      const s1 = await ingestPdf({
        buffer: extra,
        filename: "x_佐藤.pdf",
        uploadedBy: "佐藤",
        slack: slack("T1"),
      });
      assert.ok(s1.annotated);
      assert.equal((await db.latestVersion(a1.document.id))!.number, 3);
      const s2 = await ingestPdf({
        buffer: extra,
        filename: "x_佐藤.pdf",
        uploadedBy: "佐藤",
        slack: slack("T1"),
        force: true,
      });
      assert.equal(s2.version.number, 4, "「新しい版として登録」なら版になる");
      await documentActions.deleteVersion(s2.version.id);
    },
  );

  await t.test("同じ内容でも横長（スライド）は別の資料", async () => {
    const sl = await ingestPdf({
      buffer: makePdf(A3.slice(0, 120), true),
      filename: "slides.pdf",
      uploadedBy: "田中",
      slack: slack("T1"),
    });
    assert.ok(sl.isNewDocument && !sl.suggestion);
  });

  await t.test("文字がほとんど無い PDF はファイル名で決める", async () => {
    const img1 = await ingestPdf({
      buffer: makePdf(["poster"]),
      filename: "poster_v1.pdf",
      uploadedBy: "田中",
      slack: slack(undefined, "T5"),
    });
    const img2 = await ingestPdf({
      buffer: makePdf(["poster!"]),
      filename: "poster_v2.pdf",
      uploadedBy: "田中",
      slack: slack(undefined, "T6"),
    });
    assert.equal(img2.document.id, img1.document.id);
  });

  await t.test("別の人が送った似た原稿は、その人の新しい原稿", async () => {
    const o = await ingestPdf({
      buffer: makePdf(revise(A3, 0.1)),
      filename: "main.pdf",
      uploadedBy: "鈴木",
      slack: slack(undefined, "T7"),
    });
    assert.ok(o.isNewDocument);
  });

  await t.test("ほかの原稿とまったく同じ PDF は「同じファイル」", async () => {
    const other = await ingestPdf({
      buffer: makePdf(B),
      filename: "ref.pdf",
      uploadedBy: "山本",
      slack: slack("T1"),
    });
    assert.ok(other.duplicate);
    assert.equal(other.document.id, b1.document.id);
  });

  await t.test("版をまとめる・切り離す", async () => {
    const moved = (await documentActions.moveVersion(
      j1.version.id,
      a1.document.id,
    ))!;
    assert.equal(moved.number, 4);
    assert.equal(
      await db.getDocument(j1.document.id),
      undefined,
      "元の原稿は消える",
    );
    const split = (await documentActions.splitVersion(moved.id))!;
    assert.notEqual(split.document_id, a1.document.id);
    assert.equal(split.number, 1);
  });
});

test("書き込みPDF", async (t) => {
  await db.createPerson({ name: "小板 隆浩" });
  const original = makePdf(["Crowd Work Evaluation", ...paper(90)]);
  const annotated = await annotate(original);
  const v1 = await ingestPdf({
    buffer: original,
    filename: "paper_v1.pdf",
    uploadedBy: "能勢山",
  });
  const r = await ingestPdf({
    buffer: annotated,
    filename: "paper_v1_koita.pdf",
    uploadedBy: "小板",
  });

  await t.test("版は作らず、4件の書き込みをコメントにする", async () => {
    assert.equal(r.version.id, v1.version.id);
    assert.equal((await db.listVersions(v1.document.id)).length, 1);
    assert.equal(r.annotated?.count, 4);
  });

  const comments = await db.listComments(v1.version.id);
  await t.test(
    "ハイライトは名前・場所・なぞった文字つき、返信は返信になる",
    () => {
      const hl = comments.find((c) => c.body === "ここは言い切ったほうがよい");
      assert.equal(hl?.author, "小板 隆浩");
      assert.equal(hl?.kind, "text");
      assert.ok(hl?.position && hl.quote);
      assert.equal(hl?.replies[0]?.body, "了解です");
      assert.equal(hl?.replies[0]?.author, "片岡 悠");
    },
  );

  await t.test(
    "本文の無い書き込みには説明を付け、送った人の名前にする",
    async () => {
      assert.ok(comments.some((c) => c.body.startsWith("（取り消し線")));
      const ink = comments.find((c) => c.body.startsWith("（手書き"));
      assert.equal(ink?.kind, "area");
      assert.equal(ink?.author, "小板");
      assert.ok(await getFile(copyKey(ink!.copy_id!)), "書き込みPDFも保存する");
    },
  );

  await t.test("同じ書き込みPDFは二重に取り込まない", async () => {
    const again = await ingestPdf({
      buffer: annotated,
      filename: "again.pdf",
      uploadedBy: "小板",
    });
    assert.equal(again.annotated?.alreadyImported, true);
    assert.equal(
      (await db.listComments(v1.version.id)).length,
      comments.length,
    );
  });

  await t.test(
    "書き込みを読み取れないものは、全体へのコメントにリンクを付ける",
    async () => {
      const plain = Buffer.concat([original, Buffer.from("\n% resend\n")]);
      const p = await ingestPdf({
        buffer: plain,
        filename: "resend.pdf",
        uploadedBy: "小板",
      });
      const general = (await db.listComments(v1.version.id)).find(
        (c) => c.kind === "general",
      );
      assert.equal(p.annotated?.count, 0);
      assert.ok(general?.copy_id);
    },
  );

  await t.test("書き手本人が本文を変えずに送り直したら、新しい版", async () => {
    const plain = Buffer.concat([original, Buffer.from("\n% author\n")]);
    const p = await ingestPdf({
      buffer: plain,
      filename: "v2.pdf",
      uploadedBy: "能勢山",
    });
    assert.ok(!p.annotated);
    assert.equal(p.version.number, 2);
  });

  await t.test(
    "前に送った版とまったく同じファイルなら「同じファイル」",
    async () => {
      const d = await ingestPdf({
        buffer: original,
        filename: "again.pdf",
        uploadedBy: "能勢山",
      });
      assert.ok(d.duplicate);
      assert.equal(d.version.number, 1);
    },
  );
});

test("古い版への書き込みPDFは、その古い版に入る", async () => {
  const v1pdf = makePdf(["Old Version Paper", ...paper(90)]);
  const a = await ingestPdf({
    buffer: v1pdf,
    filename: "p_v1.pdf",
    uploadedBy: "A",
  });
  await ingestPdf({
    buffer: makePdf(["Totally New", ...paper(90)]),
    filename: "p_v2.pdf",
    uploadedBy: "A",
    documentId: a.document.id,
    force: true,
  });
  const r = await ingestPdf({
    buffer: await annotate(v1pdf),
    filename: "p_v1_comments.pdf",
    uploadedBy: "B",
  });
  assert.equal(r.document.id, a.document.id);
  assert.equal(r.version.number, 1);
  assert.equal(r.annotated?.latestNumber, 2);
});

test("著者を1ページ目から探す", async () => {
  const kataoka = await db.personForSlackUser("U1", ["片岡 悠", "haruka"]);
  assert.equal(
    (await db.personForSlackUser("U1", ["片岡 悠"]))!.id,
    kataoka!.id,
    "同じ Slack の人は同じ人",
  );
  assert.equal(
    (await db.findPersonByName("片岡悠"))?.id,
    kataoka!.id,
    "空白の有無は無視する",
  );
  // 1語だけのローマ字（haruka）は本文の別の言葉に当たりやすいので探さない。姓名そろった書き方を覚えさせる
  await db.addPersonName(kataoka!.id, "Haruka Kataoka");
  await db.createPerson({ name: "Hinata Tsujiura" });
  const r = await ingestPdf({
    buffer: makePdf([
      "Header Test Paper",
      "Hinata Tsujiura and haruka kataoka",
      ...paper(40),
    ]),
    filename: "h.pdf",
  });
  const authors = (await db.listAuthors(r.document.id)).map((a) => a.name);
  assert.deepEqual(authors, ["Hinata Tsujiura", "片岡 悠"]);
});
