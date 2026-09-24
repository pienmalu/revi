import { createHmac, timingSafeEqual } from "node:crypto";

/** Slack から届いたものか、署名で確かめる（5分より古いものは断る） */
export function verifySlack(
  secret: string,
  timestamp: string | null,
  signature: string | null,
  body: string,
  now = Date.now(),
) {
  if (!timestamp || !signature) return false;
  if (Math.abs(now / 1000 - Number(timestamp)) > 60 * 5) return false;
  const mine = `v0=${createHmac("sha256", secret).update(`v0:${timestamp}:${body}`).digest("hex")}`;
  const a = Buffer.from(mine);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}
