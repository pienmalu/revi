// Slack とのやりとりの土台。送り先の用意、メッセージの部品、名前の引き方。
import { WebClient, type KnownBlock } from "@slack/web-api";
import { labUrl } from "../access";
import { config } from "../config";
import * as db from "../repo";

let client: WebClient | undefined;
let auth: Promise<{ teamUrl?: string; botUserId?: string }> | undefined;

export const slackEnabled = () => Boolean(config.slackBotToken);

export function slack() {
  if (!config.slackBotToken) throw new Error("SLACK_BOT_TOKEN が未設定です");
  client ??= new WebClient(config.slackBotToken);
  return client;
}

/** ボット自身とワークスペースの情報（一度だけ引く） */
export function botInfo() {
  auth ??= slack()
    .auth.test()
    .then((r) => ({ teamUrl: r.url, botUserId: r.user_id }))
    .catch((err) => {
      auth = undefined;
      throw err;
    });
  return auth;
}

// Slack に貼るリンクには鍵を入れ、クリックするだけで開けるようにする
export function reviewUrl(documentId: string, versionNumber?: number) {
  return labUrl(
    `/d/${documentId}${versionNumber ? `?v=${versionNumber}` : ""}`,
  );
}

/** 原稿のスレッドを Slack で開くリンク */
export async function threadUrl(document: db.DocumentRow) {
  if (!slackEnabled() || !document.slack_channel || !document.slack_thread_ts)
    return null;
  const { teamUrl } = await botInfo().catch(() => ({ teamUrl: undefined }));
  if (!teamUrl) return null;
  return `${teamUrl}archives/${document.slack_channel}/p${document.slack_thread_ts.replace(".", "")}`;
}

const userNames = new Map<string, { name: string; names: string[] }>();

/** Slack の利用者の名前と、人の一覧での ID（いなければ研究室のメンバーとして登録する） */
export async function slackUser(userId: string | undefined) {
  if (!userId || !slackEnabled()) return undefined;
  let profile = userNames.get(userId);
  if (!profile) {
    try {
      const res = await slack().users.info({ user: userId });
      const p = res.user?.profile;
      profile = {
        name: p?.display_name || p?.real_name || res.user?.name || userId,
        // 本名（real_name）を人の名前にし、表示名も別の書き方として覚える
        names: [p?.real_name ?? "", p?.display_name ?? ""],
      };
      userNames.set(userId, profile);
    } catch {
      return { name: userId };
    }
  }
  // 人はまとめられて ID が変わることがあるので、毎回引き直す
  const person = await db.personForSlackUser(userId, profile.names);
  return { name: profile.name, personId: person?.id };
}

export const userName = async (userId: string | undefined) =>
  (await slackUser(userId))?.name;

// ---------- メッセージの部品 ----------

export type Block = KnownBlock;
export type Button = Record<string, unknown>;

export const plain = (t: string) => ({
  type: "plain_text",
  text: t,
  emoji: true,
});

export const openButton = (url: string, label = "添削を開く"): Button => ({
  type: "button",
  text: plain(label),
  url,
  action_id: "open_review",
  style: "primary",
});

export function actionButton(
  label: string,
  actionId: string,
  value: string,
  options: {
    style?: "primary" | "danger";
    confirm?: { title: string; body: string; ok: string };
  } = {},
): Button {
  const { style, confirm } = options;
  return {
    type: "button",
    text: plain(label),
    action_id: actionId,
    value,
    ...(style && { style }),
    ...(confirm && {
      confirm: {
        title: plain(confirm.title),
        text: plain(confirm.body),
        confirm: plain(confirm.ok),
        deny: plain("やめる"),
      },
    }),
  };
}

export function blocks(message: string, buttons: Button[] = []): Block[] {
  return [
    // 部品は手で組み立てているので、Slack の型に合わせる

    { type: "section", text: { type: "mrkdwn", text: message } },
    ...(buttons.length ? [{ type: "actions", elements: buttons }] : []),
  ] as Block[];
}

export async function post(
  channel: string,
  threadTs: string | undefined,
  message: string,
  buttons: Button[] = [],
) {
  return slack().chat.postMessage({
    channel,
    thread_ts: threadTs,
    text: message,
    blocks: blocks(message, buttons),
  });
}

/** その人への DM */
export async function dm(
  slackUserId: string,
  message: string,
  buttons: Button[] = [],
) {
  return post(slackUserId, undefined, message, buttons);
}

/** ボタンを押したメッセージを、結果の文面に置き換える */
export async function replace(
  where: { channel?: string; ts?: string },
  message: string,
  buttons: Button[] = [],
) {
  if (!where.channel || !where.ts) return;
  await slack().chat.update({
    channel: where.channel,
    ts: where.ts,
    text: message,
    blocks: blocks(message, buttons),
  });
}

export const short = (title: string) =>
  title.length > 24 ? `${title.slice(0, 23)}…` : title;
