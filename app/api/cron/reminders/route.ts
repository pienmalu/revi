import type { NextRequest } from "next/server";
import { runReminders } from "@/app/lib/reminders";
import { sendReminder } from "@/app/lib/slack/notifications";

export const maxDuration = 60;

// 毎朝 9:00（日本時間）に Vercel Cron が呼ぶ（vercel.json）。CRON_SECRET を知っている呼び出しだけ受ける
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("unauthorized", { status: 401 });
  }
  const sent = await runReminders(sendReminder);
  return Response.json({ sent: sent.length });
}
