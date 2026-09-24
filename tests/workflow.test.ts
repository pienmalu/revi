// 共著者の確認OK・提出・リマインド・業績リスト
import "./setup";
import * as documentActions from "../app/lib/document-actions";
import assert from "node:assert/strict";
import { test } from "node:test";
import { ingestPdf } from "../app/lib/ingest";
import {
  bibEntry,
  hpLine,
  hpText,
  listPublications,
} from "../app/lib/publications";
import { runReminders, type Reminder } from "../app/lib/reminders";
import * as db from "../app/lib/repo";
import { reviewOf } from "../app/lib/review";
import { stageOf } from "../app/lib/stage";
import { approve, reportSubmission } from "../app/lib/workflow";
import { config } from "../app/lib/config";
import { slack } from "../app/lib/slack/core";
import { makePdf, paper, revise } from "./pdf";

const receipt = {
  buffer: Buffer.from("受領しました"),
  filename: "receipt.eml",
  contentType: "message/rfc822",
};

test("stageOf：状態は提出前と提出済の2つ。確認OKは筆頭著者以外の全員", () => {
  const base = {
    deadline: "2026-10-01",
    submitted_at: null,
    skip_reason: null,
    authorIds: ["a", "b", "c"],
    approved: new Set<string>(),
  };
  const today = "2026-09-24";
  const open = stageOf(base, today);
  assert.equal(open.stage, "open");
  assert.deepEqual(open.waiting, ["b", "c"], "筆頭著者は確認OKを出さない");
  assert.deepEqual(
    stageOf({ ...base, approved: new Set(["b", "c"]) }, today).waiting,
    [],
  );
  assert.equal(stageOf(base, "2026-10-02").overdue, true);
  const submitted = stageOf(
    { ...base, submitted_at: "2026-09-30T00:00:00Z", skip_reason: "急いだ" },
    today,
  );
  assert.equal(submitted.stage, "submitted");
  assert.equal(submitted.skipped, true);
  assert.equal(submitted.overdue, false);
});

test("確認OK → 新しい版でやり直し → 提出 → 業績", async (t) => {
  const student = (await db.personForSlackUser("US", ["谷津 帆乃果"]))!;
  const teacher = await db.createPerson({ name: "小板 隆浩" });
  await db.setPersonNameEn(teacher.id, "Takahiro Koita");
  await db.setPersonNameEn(student.id, "Honoka Tanitsu");
  const lines = [
    "ピアレビューがレビュアーのスキル向上に与える影響の調査",
    ...paper(80),
  ];
  const v1 = await ingestPdf({
    buffer: makePdf(lines),
    filename: "lois_v1.pdf",
    uploadedBy: "谷津 帆乃果",
    uploaderId: student.id,
  });
  const id = v1.document.id;
  // テスト用の PDF は日本語の文字を持てないので、題名は手で入れる
  await documentActions.setDocumentTitle(id, lines[0]);
  await db.setAuthors(id, [student.id, teacher.id], true);
  await db.updatePaper(id, {
    venue: "電子情報通信学会技術研究報告",
    deadline: "2026-01-10",
  });

  await t.test("筆頭著者は確認OKを出せない", async () => {
    await assert.rejects(approve(id, student.id), /筆頭著者以外/);
  });

  await t.test("確認OKを繰り返しても Slack 通知は増えない", async () => {
    await db.updateDocument(id, {
      slack_channel: "C_TEST",
      slack_thread_ts: "1.0",
    });
    const previous = config.slackBotToken;
    config.slackBotToken = "test-token-no-network";
    const post = t.mock.method(slack().chat, "postMessage", async () => ({
      ok: true,
    }));
    try {
      await approve(id, teacher.id);
      assert.equal(post.mock.callCount(), 2, "個人のOKと全員完了の2投稿");
      await Promise.all([approve(id, teacher.id), approve(id, teacher.id)]);
      assert.equal(post.mock.callCount(), 2, "再操作では投稿しない");
    } finally {
      post.mock.restore();
      config.slackBotToken = previous;
      await db.updateDocument(id, {
        slack_channel: null,
        slack_thread_ts: null,
      });
    }
  });

  await t.test("新しい版が来たら、OK はやり直し", async () => {
    const review = await approve(id, teacher.id);
    assert.deepEqual(review.waiting, []);
    await ingestPdf({
      buffer: makePdf([lines[0], ...revise(lines.slice(1), 0.2)]),
      filename: "lois_v2.pdf",
      uploadedBy: "谷津 帆乃果",
      documentId: id,
    });
    const after = await reviewOf((await db.getDocument(id))!);
    assert.equal(after.latest!.number, 2);
    assert.deepEqual(after.waiting, [teacher.id]);
  });

  await t.test("全員のOKが無いまま提出するには理由が要る", async () => {
    await assert.rejects(
      reportSubmission({ documentId: id, by: "谷津", receipt }),
      /理由/,
    );
  });

  await t.test("全員OKなら、理由なしで提出できる", async () => {
    await approve(id, teacher.id);
    const d = await reportSubmission({ documentId: id, by: "谷津", receipt });
    assert.ok(d.submitted_at && !d.skip_reason);
    assert.equal((await reviewOf(d)).stage, "submitted");
  });

  await t.test("提出したら業績に入る。不採録なら外す", async () => {
    await db.updatePaper(id, {
      published_month: "2026-01",
      volume: "125",
      number: "312",
      pages: "48-53",
      paper_no: "LOIS2025-46",
    });
    const [p] = (await listPublications()).filter((x) => x.id === id);
    assert.equal(p.section, "talks");
    assert.equal(
      hpLine(p),
      "ピアレビューがレビュアーのスキル向上に与える影響の調査, 谷津帆乃果, 小板隆浩, 電子情報通信学会技術研究報告, Vol. 125, No. 312, pp. 48-53, LOIS2025-46, 2026年1月",
    );
    const bib = bibEntry(p);
    assert.match(bib, /^@inproceedings/);
    assert.match(bib, /author = \{谷津帆乃果 and 小板隆浩\}/);
    assert.match(bib, /pages = \{48--53\}/);
    assert.match(bib, /month = jan,/);
    assert.match(bib, /note = \{LOIS2025-46\}/);
    assert.match(
      hpText(await listPublications(), 2026),
      /^研究会・シンポジウム他\n1\. ピアレビュー/,
    );
    await db.updatePaper(id, { rejected: 1 });
    assert.ok(!(await listPublications()).some((x) => x.id === id));
  });
});

test("英語の国際会議は HP の英語の書き方", () => {
  const line = hpLine({
    id: "x",
    title:
      "Seasonally Adaptive Data Compression in LoRaWAN Using Huffman Coding",
    authors: [
      { id: "1", name: "國領 愛理", name_en: "Airi Kokuryo" },
      { id: "2", name: "小板 隆浩", name_en: "Takahiro Koita" },
    ],
    venue:
      "4th International Conference on Computational Engineering and Science for Safety and Environmental Problems",
    journal: false,
    volume: null,
    number: null,
    pages: null,
    paper_no: null,
    note: null,
    month: "2025-07",
    section: "papers",
    japanese: false,
  });
  assert.equal(
    line,
    "Seasonally Adaptive Data Compression in LoRaWAN Using Huffman Coding, Airi Kokuryo, Takahiro Koita, the proceedings of 4th International Conference on Computational Engineering and Science for Safety and Environmental Problems, July, 2025.",
  );
});

test("リマインド：まだOKが無い人を7日前・3日前・前日に。締切超過は筆頭著者に。二度送らない", async () => {
  const owner = (await db.personForSlackUser("UO", ["馬場 元岐"]))!;
  const koita = (await db.findPersonByName("小板 隆浩"))!;
  const r = await ingestPdf({
    buffer: makePdf(["Reminder Test Paper", ...paper(60)]),
    filename: "r.pdf",
    uploadedBy: "馬場 元岐",
    uploaderId: owner.id,
  });
  await db.setAuthors(r.document.id, [owner.id, koita.id], true);
  await db.updatePaper(r.document.id, {
    venue: "DPSWS",
    deadline: "2026-10-01",
  });
  const sent: Reminder[] = [];
  const send = async (x: Reminder) => void sent.push(x);
  const mine = () => sent.filter((x) => x.documentId === r.document.id);

  await runReminders(send, "2026-09-24");
  assert.equal(mine().length, 1);
  assert.deepEqual(mine()[0].to, [koita.id]);
  assert.match(mine()[0].message, /あと7日/);

  await runReminders(send, "2026-09-24");
  assert.equal(mine().length, 1, "同じ日にもう一度動いても送らない");

  await approve(r.document.id, koita.id);
  await runReminders(send, "2026-09-28");
  assert.equal(mine().length, 1, "全員OKなら、締切前は知らせない");

  await runReminders(send, "2026-10-02");
  assert.equal(mine().at(-1)!.kind, "overdue");
  assert.deepEqual(mine().at(-1)!.to, [owner.id]);
});

test("スライドは版と添削だけ。確認・提出・締切通知・業績の対象にしない", async () => {
  const owner = await db.createPerson({ name: "Slide Owner" });
  const reviewer = await db.createPerson({ name: "Slide Reviewer" });
  const first = await ingestPdf({
    buffer: makePdf(["Slide Deck", ...paper(30)], true),
    filename: "slides.pdf",
    uploaderId: owner.id,
  });
  const id = first.document.id;
  await db.setAuthors(id, [owner.id, reviewer.id], true);
  await db.updatePaper(id, { deadline: "2026-10-01" });
  await ingestPdf({
    buffer: makePdf(["Slide Deck", ...revise(paper(30), 0.2)], true),
    filename: "slides-v2.pdf",
    documentId: id,
    uploaderId: owner.id,
  });
  const document = (await db.getDocument(id))!;
  const review = await reviewOf(document);
  assert.equal(review.latest?.number, 2);
  assert.equal(review.stage, "slides");
  assert.deepEqual(review.people, []);
  assert.equal(review.overdue, false);
  await assert.rejects(approve(id, reviewer.id), /スライド/);
  await assert.rejects(
    reportSubmission({ documentId: id, by: owner.name, receipt }),
    /スライド/,
  );
  assert.equal((await db.getDocument(id))!.submitted_at, null);
  const { listPapers } = await import("../app/lib/papers");
  assert.equal((await listPapers()).find((p) => p.id === id)?.stage, "slides");
  for (const date of ["2026-09-24", "2026-09-28", "2026-09-30", "2026-10-02"]) {
    const sent: Reminder[] = [];
    await runReminders(async (r) => {
      sent.push(r);
    }, date);
    assert.ok(!sent.some((r) => r.documentId === id));
  }
  // 以前の提出記録が残っていてもスライドを業績に入れない。
  await db.updateDocument(id, { submitted_at: "2026-09-24T00:00:00Z" });
  assert.ok(!(await listPublications()).some((p) => p.id === id));
  const { staleReviewNote } = await import("../app/lib/slack/notifications");
  const { onReviewAction } = await import("../app/lib/slack/review");
  assert.equal(await staleReviewNote(document, review.latest!), null);
  // 古い共有ボタンから操作しても、Slackへの投稿や提出画面を開かない。
  await onReviewAction("report_submission", id, {
    user: { id: "TEST" },
    trigger_id: "TEST",
  });
});

test("通知失敗・送信先なしを送信済みにしない", async (t) => {
  const result = await ingestPdf({
    buffer: makePdf(["Retry reminder", ...paper(20)]),
    filename: "retry.pdf",
  });
  const id = result.document.id;
  await db.updatePaper(id, { deadline: "2026-08-01" });
  const quiet = t.mock.method(console, "error", () => {});
  try {
    const failed = await runReminders(async () => {
      throw new Error("offline");
    }, "2026-08-02");
    assert.ok(!failed.some((r) => r.documentId === id));
    const skipped = await runReminders(async () => false, "2026-08-02");
    assert.ok(!skipped.some((r) => r.documentId === id));
    const sent = await runReminders(async () => {}, "2026-08-02");
    assert.ok(sent.some((r) => r.documentId === id));
    const again = await runReminders(async () => {}, "2026-08-02");
    assert.ok(!again.some((r) => r.documentId === id));
  } finally {
    quiet.mock.restore();
  }
});

test("提出報告の同時実行で受領メールを上書きしない", async () => {
  const result = await ingestPdf({
    buffer: makePdf(["Concurrent submission", ...paper(23)]),
    filename: "concurrent.pdf",
  });
  const id = result.document.id;
  const attempts = await Promise.allSettled([
    reportSubmission({ documentId: id, by: "First", receipt }),
    reportSubmission({ documentId: id, by: "Second", receipt }),
  ]);
  assert.equal(attempts.filter((r) => r.status === "fulfilled").length, 1);
  const winner = attempts.find((r) => r.status === "fulfilled")!;
  assert.equal(winner.status, "fulfilled");
  if (winner.status === "fulfilled") {
    const recorded = (await db.getDocument(id))!;
    assert.equal(recorded.receipt_key, winner.value.receipt_key);
    const { getFile } = await import("../app/lib/storage");
    assert.deepEqual(await getFile(recorded.receipt_key!), receipt.buffer);
  }
});

test("Slack送信失敗でも保存済みの確認と提出は成功として返す", async (t) => {
  const owner = await db.createPerson({ name: "Notify Owner" });
  const reviewer = await db.createPerson({ name: "Notify Reviewer" });
  const result = await ingestPdf({
    buffer: makePdf(["Notification failure", ...paper(27)]),
    filename: "notification.pdf",
  });
  const id = result.document.id;
  await db.setAuthors(id, [owner.id, reviewer.id], true);
  await db.updateDocument(id, {
    slack_channel: "C_TEST",
    slack_thread_ts: "2.0",
  });
  const previous = config.slackBotToken;
  config.slackBotToken = "test-token-no-network";
  const post = t.mock.method(slack().chat, "postMessage", async () => {
    throw new Error("offline");
  });
  const quiet = t.mock.method(console, "error", () => {});
  try {
    assert.deepEqual((await approve(id, reviewer.id)).waiting, []);
    const submitted = await reportSubmission({
      documentId: id,
      by: owner.name,
      receipt,
    });
    assert.ok(submitted.submitted_at);
    assert.ok((await db.getDocument(id))!.submitted_at);
  } finally {
    post.mock.restore();
    quiet.mock.restore();
    config.slackBotToken = previous;
  }
});

test("同じ原稿への同時登録は版番号を分け、同一PDFは重複させない", async () => {
  const d = await db.createDocument({
    title: "Concurrent versions",
    normalizedTitle: "concurrent",
  });
  const unique = await Promise.all(
    Array.from({ length: 5 }, (_, i) =>
      db.addVersion({
        documentId: d.id,
        filename: `${i}.pdf`,
        sha256: `sha-${i}`,
      }),
    ),
  );
  assert.equal(new Set(unique.map((r) => r.version.number)).size, 5);
  const same = await Promise.all(
    Array.from({ length: 5 }, () =>
      db.addVersion({
        documentId: d.id,
        filename: "same.pdf",
        sha256: "same-sha",
      }),
    ),
  );
  assert.equal(new Set(same.map((r) => r.version.id)).size, 1);
  assert.equal(same.filter((r) => !r.duplicate).length, 1);
});
