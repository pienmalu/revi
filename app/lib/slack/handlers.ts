// Slack から届くもの（イベント・ボタン・入力画面）の振り分け。
// 受け方（Vercel で HTTP で受けるか、手元で Socket Mode で受けるか）には関係なく動く。
import { botInfo } from "./core";
import { onReviewAction, onReviewView, type ViewPayload } from "./review";
import {
  forceVersion,
  handlePdf,
  mergeVersion,
  reportFailure,
  splitVersionAction,
  undoVersion,
  type ActionBody,
  type SlackFile,
} from "./pdf";

type MessageEvent = {
  type: string;
  subtype?: string;
  channel: string;
  ts: string;
  thread_ts?: string;
  user?: string;
  bot_id?: string;
  text?: string;
  files?: SlackFile[];
};

/** Events API のイベント（event_callback の event） */
export async function handleEvent(event: MessageEvent) {
  if (event.type !== "message" || event.bot_id || !event.files?.length) return;
  // イベントの案内など関係のない PDF も多いので、ボットをメンションしたときだけ登録する（スレッド内でも同じ）
  const { botUserId } = await botInfo();
  if (!botUserId || !event.text?.includes(`<@${botUserId}>`)) return;
  const pdfs = event.files.filter(
    (f) => f.filetype === "pdf" || f.mimetype === "application/pdf",
  );
  for (const file of pdfs) {
    const where = {
      channel: event.channel,
      ts: event.ts,
      thread_ts: event.thread_ts,
      user: event.user,
    };
    await handlePdf(file, where).catch((err) =>
      reportFailure(file, where, err),
    );
  }
}

export type Interaction = ActionBody & {
  type: string;
  actions?: { action_id: string; value?: string }[];
  view?: ViewPayload["view"];
};

const REVIEW_ACTIONS = new Set(["approve", "report_submission"]);

/**
 * ボタンや入力画面の操作。Slack には3秒以内に返事をする決まりがあるので、
 * すぐ返す中身（response）と、返したあとに続ける処理（later）に分けて返す。
 */
export async function handleInteraction(payload: Interaction): Promise<{
  response?: unknown;
  later?: () => Promise<void>;
}> {
  if (payload.type === "view_submission" && payload.view) {
    return onReviewView(payload as ViewPayload);
  }
  if (payload.type === "block_actions") {
    const action = payload.actions?.[0];
    if (!action) return {};
    const value = action.value ?? "";
    if (REVIEW_ACTIONS.has(action.action_id)) {
      return { later: () => onReviewAction(action.action_id, value, payload) };
    }
    const run: Record<string, () => Promise<void>> = {
      undo_version: () => undoVersion(payload, value),
      merge_version: () => mergeVersion(payload, value),
      split_version: () => splitVersionAction(payload, value),
      force_version: () => forceVersion(payload, value),
    };
    // URL ボタン（open_review）でも操作が届くが、することは無い
    return { later: run[action.action_id] };
  }
  return {};
}
