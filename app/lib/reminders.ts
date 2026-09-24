// 毎朝のリマインド。締切の7日前・3日前・前日に、まだ確認OKを出していない人を
// 原稿の Slack スレッドでメンションする。締切を過ぎても報告が無ければ、筆頭著者に1回だけ知らせる。
// 同じ原稿・同じ締切・同じ種類のリマインドは一度しか送らない（reminders_sent）。
import * as db from "./repo";
import { reviewOf } from "./review";
import { daysUntil, todayJst } from "./stage";

export type Reminder = {
  documentId: string;
  kind: "d7" | "d3" | "d1" | "overdue";
  /** メンションする人（people.id） */
  to: string[];
  /** 締切の知らせ（「あと3日」など）。メンションは送る側で付ける */
  message: string;
  /** 「提出を報告」ボタンを付けるか */
  submit: boolean;
};

const KIND: Record<number, Reminder["kind"]> = { 7: "d7", 3: "d3", 1: "d1" };

/** 今日送るリマインド（まだ送っていないもの） */
export async function dueReminders(today = todayJst()): Promise<Reminder[]> {
  const out: Reminder[] = [];
  for (const document of await db.documentsIn()) {
    if (!document.deadline || document.submitted_at) continue;
    const left = daysUntil(document.deadline, today);
    const kind = left < 0 ? "overdue" : KIND[left];
    if (!kind) continue;
    const review = await reviewOf(document);
    if (!review.latest || review.stage === "slides") continue;
    const sent = await db.reminderWasSent(document.id, kind, document.deadline);
    if (sent) continue;
    if (kind === "overdue") {
      const [first] = await db.listAuthors(document.id);
      out.push({
        documentId: document.id,
        kind,
        to: first ? [first.id] : [],
        message: `⏰ 締切（${document.deadline}）を過ぎました。提出したら、受領メールを添えて報告してください。`,
        submit: true,
      });
      continue;
    }
    if (!review.waiting.length) continue;
    const days = left === 1 ? "明日が締切" : `締切まであと${left}日`;
    out.push({
      documentId: document.id,
      kind,
      to: review.waiting,
      message: `⏰ ${days}です。v${review.latest.number} の確認をお願いします。`,
      submit: false,
    });
  }
  return out;
}

export async function claimReminder(
  r: Pick<Reminder, "documentId" | "kind">,
  deadline: string,
) {
  return db.recordReminder(r.documentId, r.kind, deadline);
}

/** リマインドを送る。send に Slack への投稿を渡す（テストでは記録するだけの関数を渡す） */
export async function runReminders(
  send: (r: Reminder) => Promise<void | boolean>,
  today = todayJst(),
) {
  const due = await dueReminders(today);
  const sent: Reminder[] = [];
  for (const r of due) {
    const document = await db.getDocument(r.documentId);
    if (!document?.deadline) continue;
    // DBの一意制約で送信権を取る。別の実行が先に取得していたら送らない。
    if (!(await claimReminder(r, document.deadline))) continue;
    try {
      if ((await send(r)) === false) {
        await db.releaseReminder(r.documentId, r.kind, document.deadline);
        continue;
      }
      sent.push(r);
    } catch (err) {
      await db.releaseReminder(r.documentId, r.kind, document.deadline);
      console.error("[reminders]", err);
    }
  }
  return sent;
}
