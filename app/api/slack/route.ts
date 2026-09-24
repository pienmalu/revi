import { after, type NextRequest } from "next/server";
import { config } from "@/app/lib/config";
import {
  handleEvent,
  handleInteraction,
  type Interaction,
} from "@/app/lib/slack/handlers";
import { verifySlack } from "@/app/lib/slack/verify";

// PDF の読み取りは時間がかかることがあるので、返事をしたあとも続けられるようにしておく
export const maxDuration = 60;

/** Slack の Events API とボタン・入力画面（Interactivity）の受け口 */
export async function POST(req: NextRequest) {
  const body = await req.text();
  if (
    !config.slackSigningSecret ||
    !verifySlack(
      config.slackSigningSecret,
      req.headers.get("x-slack-request-timestamp"),
      req.headers.get("x-slack-signature"),
      body,
    )
  ) {
    return new Response("invalid signature", { status: 401 });
  }

  // ボタンや入力画面は payload=... の形で届く
  if (body.startsWith("payload=")) {
    const payload = JSON.parse(
      new URLSearchParams(body).get("payload") ?? "{}",
    ) as Interaction;
    const { response, later } = await handleInteraction(payload);
    if (later)
      after(() => later().catch((err) => console.error("[slack]", err)));
    return response
      ? Response.json(response)
      : new Response(null, { status: 200 });
  }

  const data = JSON.parse(body) as {
    type: string;
    challenge?: string;
    event?: unknown;
  };
  if (data.type === "url_verification")
    return Response.json({ challenge: data.challenge });
  // 返事が遅れて Slack が送り直してきたものは、すでに受け取っているので無視する
  if (req.headers.get("x-slack-retry-num"))
    return new Response(null, { status: 200 });
  if (data.type === "event_callback" && data.event) {
    const event = data.event as Parameters<typeof handleEvent>[0];
    after(() =>
      handleEvent(event).catch((err) => console.error("[slack]", err)),
    );
  }
  return new Response(null, { status: 200 });
}
