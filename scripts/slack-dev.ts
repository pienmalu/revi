// 手元で Slack を試すための中継。
// 本番（Vercel）では Slack が /api/slack を直接呼ぶが、手元の PC は外から呼べないので、
// Socket Mode（こちらから Slack につなぐ方式）で受け取り、手元の /api/slack に同じ形で渡す。
// データベース（PGlite）は1つのプログラムからしか開けないので、ここでは開かない。
//
// 使い方：pnpm dev を動かしたまま、別のターミナルで pnpm slack:dev
// 要るもの：SLACK_APP_TOKEN（xapp-...）、SLACK_BOT_TOKEN と手元の署名キー SLACK_DEV_SIGNING_SECRET
import { createHmac } from "node:crypto";
import { SocketModeClient } from "@slack/socket-mode";

const appToken = process.env.SLACK_APP_TOKEN;
const secret =
  process.env.SLACK_DEV_SIGNING_SECRET || process.env.SLACK_SIGNING_SECRET;
const target = `${(process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "")}/api/slack`;
if (!appToken || !secret) {
  console.error(
    "SLACK_APP_TOKEN と SLACK_DEV_SIGNING_SECRET（または SLACK_SIGNING_SECRET）を .env.local に入れてください",
  );
  process.exit(1);
}

/** Slack と同じ署名を付けて、手元の /api/slack に送る */
async function relay(body: string, contentType: string) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = `v0=${createHmac("sha256", secret!).update(`v0:${timestamp}:${body}`).digest("hex")}`;
  const res = await fetch(target, {
    method: "POST",
    headers: {
      "Content-Type": contentType,
      "X-Slack-Request-Timestamp": timestamp,
      "X-Slack-Signature": signature,
    },
    body,
  });
  if (!res.ok)
    throw new Error(`手元の /api/slack が HTTP ${res.status} を返しました`);
  const text = await res.text();
  return text ? (JSON.parse(text) as Record<string, unknown>) : undefined;
}

const client = new SocketModeClient({ appToken });

client.on("slack_event", async ({ ack, type, body }) => {
  try {
    if (type === "events_api") {
      await ack();
      await relay(JSON.stringify(body), "application/json");
    } else if (type === "interactive") {
      // 入力画面のまちがい（response_action: errors）は、ack で Slack に返す
      const response = await relay(
        `payload=${encodeURIComponent(JSON.stringify(body))}`,
        "application/x-www-form-urlencoded",
      );
      await ack(response);
    } else {
      await ack();
    }
  } catch (err) {
    console.error(
      "[slack:dev] 手元のサーバーに渡せませんでした（pnpm dev は動いていますか？）",
      err,
    );
  }
});

await client.start();
console.log(`[slack:dev] Slack とつながりました。${target} に中継します`);
