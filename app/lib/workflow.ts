// 原稿を先へ進める操作は2つだけ：共著者の確認OKと、提出の報告。
// Slack のボタンからも画面からも同じ関数を呼ぶ。Slack への知らせは slack/notifications.ts に任せる。
import { HttpError } from "./errors";
import * as db from "./repo";
import { reviewOf } from "./review";
import { announceApproval, announceSubmission } from "./slack/notifications";
import { deleteFiles, putFile, receiptKey } from "./storage";

/** 共著者の確認OK。いちばん新しい版に対して記録する（新しい版が来たら、やり直し） */
export async function approve(documentId: string, personId: string) {
  const document = await db.getDocument(documentId);
  if (!document) throw new HttpError(404, "原稿が見つかりません");
  const before = await reviewOf(document);
  if (before.stage === "slides")
    throw new HttpError(400, "スライドは添削のみです。確認OKは不要です");
  if (!before.latest) throw new HttpError(400, "PDF がまだありません");
  if (!before.reviewers.includes(personId))
    throw new HttpError(
      403,
      "確認OKを出すのは、筆頭著者以外の共著者です。著者に入っているか確かめてください",
    );
  const added = await db.setApproval(before.latest.id, personId);
  const after = await reviewOf(document);
  // 連打や Slack の再送でも、同じ人・同じ版の通知を繰り返さない。
  if (!added) return after;
  const person = (await db.getPerson(personId))!;
  await announceApproval(document, before.latest, after, person).catch((err) =>
    console.error("[slack] 確認OKは記録済みですが通知できませんでした", err),
  );
  return after;
}

/** 提出を報告する（最新版を出したものとする）。受領メールは必須。全員のOKが無ければ理由も要る */
export async function reportSubmission(input: {
  documentId: string;
  by: string;
  receipt: { buffer: Buffer; filename: string; contentType: string };
  reason?: string;
}) {
  const document = await db.getDocument(input.documentId);
  if (!document) throw new HttpError(404, "原稿が見つかりません");
  if (document.submitted_at)
    throw new HttpError(400, "すでに提出の報告があります");
  const review = await reviewOf(document);
  if (review.stage === "slides")
    throw new HttpError(400, "スライドの提出報告は不要です");
  if (!review.latest) throw new HttpError(400, "PDF がまだありません");
  const allOk = !review.waiting.length;
  const reason = input.reason?.trim();
  if (!allOk && !reason)
    throw new HttpError(
      400,
      "全員の確認OKがそろっていません。理由を書いてください",
    );
  const key = receiptKey(document.id, input.receipt.filename);
  await putFile(key, input.receipt.buffer, input.receipt.contentType);
  const updated = await db.recordSubmission(document.id, {
    submitted_at: new Date().toISOString(),
    submitted_by: input.by,
    submitted_version_id: review.latest.id,
    receipt_key: key,
    receipt_name: input.receipt.filename,
    skip_reason: allOk ? null : reason!,
  });
  if (!updated) {
    await deleteFiles([key]);
    throw new HttpError(
      409,
      "すでに提出の報告があります。画面を更新してください",
    );
  }
  await announceSubmission(updated, review.latest, review).catch((err) =>
    console.error("[slack] 提出は記録済みですが通知できませんでした", err),
  );
  return updated;
}

/** 提出の報告を取り消す（まちがえて押したとき） */
export async function undoSubmission(documentId: string) {
  return db.updateDocument(documentId, {
    submitted_at: null,
    submitted_by: null,
    submitted_version_id: null,
    receipt_key: null,
    receipt_name: null,
    skip_reason: null,
  });
}
