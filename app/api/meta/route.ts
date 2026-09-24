import { handle, json } from "@/app/lib/http";
import * as db from "@/app/lib/repo";
import { slackEnabled } from "@/app/lib/slack/core";

export const GET = handle(async () =>
  json({
    slack: slackEnabled(),
    authors: await db.knownAuthors(),
    // Vercel Blob を使うときは、PDF をブラウザから直接 Blob に送る（サーバーには 4.5MB までしか送れないため）
    blobUpload: Boolean(process.env.BLOB_READ_WRITE_TOKEN),
  }),
);
