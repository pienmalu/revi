// テストの前に必ず読み込む。本物のデータベースと PDF の置き場所には触らない。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

if (process.env.DATABASE_URL || process.env.BLOB_READ_WRITE_TOKEN) {
  throw new Error(
    "テストは本物の DATABASE_URL / BLOB_READ_WRITE_TOKEN があると動かしません",
  );
}
process.env.PGLITE_DIR = "memory";
process.env.FILES_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "revi-test-"));
delete process.env.SLACK_BOT_TOKEN;
