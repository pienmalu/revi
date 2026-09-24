// Slack での共著者の確認OKと提出の報告。
// ボタンと入力画面を受け付け、共通のworkflowを呼ぶ。
import * as db from "../repo";
import { approve, reportSubmission } from "../workflow";
import { reviewOf, type Review } from "../review";
import { dm, plain, slack, slackUser, type Block } from "./core";

const md = (text: string): Block =>
  ({ type: "section", text: { type: "mrkdwn", text } }) as Block;

// ---------- 提出の報告の入力画面（モーダル） ----------

type View = Record<string, unknown>;

async function submissionView(document: db.DocumentRow, review: Review) {
  const blocks: Block[] = [
    md(
      "学会などへの提出は自分で行います。この画面では、提出済みの記録を残します。",
    ),
    md(
      `*${document.title}* v${review.latest?.number ?? "?"}${document.venue ? `\n提出先：${document.venue}` : ""}`,
    ),
    {
      type: "input",
      block_id: "receipt",
      label: plain("受領メール（ファイルかスクリーンショット）"),
      element: { type: "file_input", action_id: "v", max_files: 1 },
    } as Block,
  ];
  if (review.waiting.length) {
    const names = review.people
      .filter((p) => !p.ok)
      .map((p) => p.name)
      .join("、");
    blocks.push(md(`⚠️ まだ確認OKが無い人がいます：${names}`), {
      type: "input",
      block_id: "reason",
      label: plain("それでも出す理由"),
      element: {
        type: "plain_text_input",
        action_id: "v",
        multiline: true,
      },
    } as Block);
  }
  return {
    type: "modal",
    callback_id: "submission",
    title: plain("提出を報告"),
    submit: plain("報告する"),
    close: plain("やめる"),
    private_metadata: JSON.stringify({ documentId: document.id }),
    blocks,
  } satisfies View;
}

// ---------- ボタンと入力画面を受ける ----------

export type ActionPayload = {
  user: { id: string };
  trigger_id?: string;
  channel?: { id: string };
  message?: { ts: string; thread_ts?: string };
  container?: { channel_id?: string; message_ts?: string };
};

/** 押した人にだけ見える返事 */
async function whisper(b: ActionPayload, text: string) {
  const channel = b.channel?.id ?? b.container?.channel_id;
  if (!channel) return;
  await slack().chat.postEphemeral({
    channel,
    user: b.user.id,
    text,
    ...(b.message?.thread_ts && { thread_ts: b.message.thread_ts }),
  });
}

export async function onReviewAction(
  actionId: string,
  value: string,
  b: ActionPayload,
) {
  const document = await db.getDocument(value);
  if (!document) return whisper(b, "この原稿は削除されています。");
  if ((await reviewOf(document)).stage === "slides")
    return whisper(
      b,
      "スライドは版の管理と添削のみです。確認OKや提出報告は不要です。",
    );
  if (actionId === "report_submission") {
    if (document.submitted_at)
      return whisper(b, "この原稿は、もう提出の報告があります。");
    if (!b.trigger_id) return;
    await slack().views.open({
      trigger_id: b.trigger_id,
      view: (await submissionView(document, await reviewOf(document))) as never,
    });
    return;
  }
  if (actionId === "approve") {
    const user = await slackUser(b.user.id);
    if (!user?.personId)
      return whisper(
        b,
        "Slack の名前が著者の名前と合わず、だれか分かりませんでした。添削画面の「確認OK」から押してください。",
      );
    await approve(document.id, user.personId).catch((err) =>
      whisper(b, `⚠️ ${(err as Error).message}`),
    );
  }
}

type Values = Record<string, Record<string, Record<string, unknown>>>;

export type ViewPayload = {
  user: { id: string };
  view: {
    callback_id: string;
    private_metadata?: string;
    state: { values: Values };
  };
};

/**
 * 提出の報告の「報告する」。まちがいがあれば、画面にその場で出す（response_action: errors）。
 * Slack には3秒以内に返事をする決まりがあるので、重い処理は later に回す。
 */
export async function onReviewView(
  p: ViewPayload,
): Promise<{ response?: unknown; later?: () => Promise<void> }> {
  if (p.view.callback_id !== "submission") return {};
  const { documentId } = JSON.parse(p.view.private_metadata || "{}") as {
    documentId: string;
  };
  const document = await db.getDocument(documentId);
  if (!document) return {};
  const values = p.view.state.values;
  const reason = (
    values.reason?.v as { value?: string } | undefined
  )?.value?.trim();
  const file = (
    values.receipt?.v as
      | {
          files?: {
            id: string;
            name?: string;
            mimetype?: string;
            url_private_download?: string;
          }[];
        }
      | undefined
  )?.files?.[0];
  const review = await reviewOf(document);
  const errors: Record<string, string> = {};
  if (!file)
    errors.receipt = "受領メールのファイルかスクリーンショットを添えてください";
  if (review.waiting.length && !reason) errors.reason = "理由を書いてください";
  if (Object.keys(errors).length)
    return { response: { response_action: "errors", errors } };
  return {
    later: async () => {
      const user = await slackUser(p.user.id);
      const info = file!.url_private_download
        ? file!
        : ((await slack().files.info({ file: file!.id })).file as typeof file);
      const res = await fetch(info!.url_private_download!, {
        headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}` },
      });
      if (!res.ok)
        throw new Error(
          `受領メールのダウンロードに失敗しました: ${res.status}`,
        );
      await reportSubmission({
        documentId: document.id,
        by: user?.name ?? p.user.id,
        receipt: {
          buffer: Buffer.from(await res.arrayBuffer()),
          filename: info!.name ?? "receipt",
          contentType: info!.mimetype ?? "application/octet-stream",
        },
        reason,
      }).catch((err) =>
        dm(
          p.user.id,
          `⚠️ 提出を報告できませんでした（${(err as Error).message}）`,
        ),
      );
    },
  };
}
