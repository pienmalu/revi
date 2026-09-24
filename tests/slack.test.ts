// Slack から届いたものかの確かめ（署名）と、入力画面のまちがいの返し方
import "./setup";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import { handleInteraction } from "../app/lib/slack/handlers";
import { verifySlack } from "../app/lib/slack/verify";
import * as db from "../app/lib/repo";

test("署名が正しいものだけ受ける", () => {
  const secret = "s3cret";
  const now = Date.now();
  const ts = String(Math.floor(now / 1000));
  const body = "payload=%7B%7D";
  const sig = `v0=${createHmac("sha256", secret).update(`v0:${ts}:${body}`).digest("hex")}`;
  assert.equal(verifySlack(secret, ts, sig, body, now), true);
  assert.equal(
    verifySlack(secret, ts, sig, body + "x", now),
    false,
    "中身が変わっていたら断る",
  );
  assert.equal(verifySlack("other", ts, sig, body, now), false);
  assert.equal(
    verifySlack(secret, ts, sig, body, now + 10 * 60_000),
    false,
    "古いものは断る",
  );
});

test("提出の報告で、受領メールが無ければその場で知らせる", async () => {
  const d = await db.createDocument({ title: "t", normalizedTitle: "t" });
  const { response, later } = await handleInteraction({
    type: "view_submission",
    user: { id: "U1" },
    view: {
      callback_id: "submission",
      private_metadata: JSON.stringify({ documentId: d.id }),
      state: { values: { receipt: { v: { files: [] } } } },
    },
  });
  assert.equal(later, undefined);
  assert.deepEqual(response, {
    response_action: "errors",
    errors: {
      receipt: "受領メールのファイルかスクリーンショットを添えてください",
    },
  });
});
