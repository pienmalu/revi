// Slackへの通知。操作の受付やworkflowの呼び出しは持たない。
import * as db from "../repo";
import { reviewOf, type Review } from "../review";
import {
  actionButton,
  openButton,
  post,
  reviewUrl,
  slackEnabled,
  type Button,
} from "./core";

/** 人を Slack の書き方にする（Slack につながっていなければ名前のまま） */
async function mention(personId: string) {
  const p = await db.getPerson(personId);
  if (!p) return "";
  return p.slack_user_id ? `<@${p.slack_user_id}>` : `${p.name}さん`;
}

const mentions = async (ids: string[]) =>
  (await Promise.all(ids.map(mention))).join(" ");

/** スレッドに流す（Slack とつながっていない原稿なら何もしない） */
async function toThread(
  document: db.DocumentRow,
  message: string,
  buttons: Button[] = [],
) {
  if (!slackEnabled() || !document.slack_channel || !document.slack_thread_ts)
    return;
  await post(
    document.slack_channel,
    document.slack_thread_ts,
    message,
    buttons,
  );
}

// ---------- ボタン ----------

export const approveButton = (documentId: string) =>
  actionButton("確認OK", "approve", documentId);

const submitButton = (documentId: string) =>
  actionButton("提出を報告", "report_submission", documentId, {
    style: "primary",
  });

// ---------- 知らせ ----------

/** 新しい版が来たとき、前の版の確認OKがやり直しになることを添える */
export async function staleReviewNote(
  document: db.DocumentRow,
  version: db.VersionRow,
) {
  if (version.layout === "landscape") return null;
  const versions = await db.listVersions(document.id);
  const previous = versions.filter((v) => v.number < version.number).at(-1);
  if (!previous || !(await db.approvalsFor(previous.id)).length) return null;
  return `確認OKは版ごとです。v${version.number} をもう一度確認してください。`;
}

export async function announceApproval(
  document: db.DocumentRow,
  version: db.VersionRow,
  review: Review,
  person: db.PersonRow,
) {
  const done = review.reviewers.length - review.waiting.length;
  await toThread(
    document,
    `✅ ${person.name}さんが v${version.number} を確認OK（${done}/${review.reviewers.length}）`,
  );
  if (!review.waiting.length) {
    await toThread(
      document,
      "🎉 全員の確認OKがそろいました。提出したら、受領メールを添えて報告してください。",
      [submitButton(document.id)],
    );
  }
}

export async function announceSubmission(
  document: db.DocumentRow,
  version: db.VersionRow,
  review: Review,
) {
  if (!slackEnabled() || !document.slack_channel) return;
  // お礼の投稿はチャンネルに（スレッドの外に）出す
  const helpers = await mentions(
    review.reviewers.filter((id) => !review.waiting.includes(id)),
  );
  await post(
    document.slack_channel,
    undefined,
    `📮「${document.title}」を${document.venue ? `${document.venue}に` : ""}提出しました。${helpers ? `確認してくださった ${helpers}、ありがとうございました。` : ""}`,
  );
  const skipped = document.skip_reason
    ? `\n⚠️ 確認OKがそろわないまま提出しました（理由：${document.skip_reason}）。まだだった人：${await mentions(review.waiting)}`
    : "";
  await toThread(
    document,
    `📮 ${document.submitted_by}さんが v${version.number} を提出しました。${skipped}`,
  );
}

/** 毎朝のリマインドを、原稿のスレッドに流す */
export async function sendReminder(r: {
  documentId: string;
  to: string[];
  message: string;
  submit: boolean;
}) {
  const document = await db.getDocument(r.documentId);
  if (
    !document ||
    !slackEnabled() ||
    !document.slack_channel ||
    !document.slack_thread_ts ||
    (await reviewOf(document)).stage === "slides"
  )
    return false;
  const who = await mentions(r.to);
  const buttons = [openButton(await reviewUrl(document.id))];
  buttons.push(
    r.submit ? submitButton(document.id) : approveButton(document.id),
  );
  await toThread(document, `${who} ${r.message}`, buttons);
}
