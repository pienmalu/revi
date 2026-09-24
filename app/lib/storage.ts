// PDF などのファイルの置き場所。
// - BLOB_READ_WRITE_TOKEN があれば Vercel Blob（非公開）に置く（本番）
// - 無ければ手元の data/files に置く（開発とテスト。テストでは FILES_DIR で別の場所にする）
// 置き場所は「pdfs/<版のID>.pdf」のような名前（key）で指す。Blob の URL は画面に出さず、API を通して返す。

import { HttpError } from "./errors";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

const blobEnabled = () => {
  if (process.env.VERCEL && !process.env.BLOB_READ_WRITE_TOKEN)
    throw new Error("Vercel では BLOB_READ_WRITE_TOKEN が必要です");
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
};
const localDir = () =>
  process.env.FILES_DIR ?? path.join(process.cwd(), "data", "files");

/** ファイル操作の境界で検証し、保存フォルダ外への移動を防ぐ。 */
export function validateFileKey(key: string) {
  if (
    !key ||
    key.includes("\\") ||
    key.includes("\0") ||
    key.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    throw new HttpError(400, "ファイルの保存先が不正です");
  }
}

export const pdfKey = (versionId: string) => `pdfs/${versionId}.pdf`;
export const copyKey = (copyId: string) => `copies/${copyId}.pdf`;
export const receiptKey = (documentId: string, filename: string) =>
  `receipts/${documentId}/${randomUUID()}-${filename.replace(/[^\w.\-]+/g, "_")}`;

export async function putFile(
  key: string,
  body: Buffer,
  contentType = "application/pdf",
) {
  validateFileKey(key);
  if (blobEnabled()) {
    const { put } = await import("@vercel/blob");
    await put(key, body, {
      access: "private",
      contentType,
      addRandomSuffix: false,
      allowOverwrite: true,
    });
    return;
  }
  // 実行時の利用者データはビルド時の同梱対象にしない。
  const file = path.join(/* turbopackIgnore: true */ localDir(), key);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, body);
}

/** ファイルの中身。無ければ undefined */
export async function getFile(key: string): Promise<Buffer | undefined> {
  const stream = await getFileStream(key);
  return stream
    ? Buffer.from(await new Response(stream).arrayBuffer())
    : undefined;
}

/** 配信用。PDF全体をメモリに載せず、そのままブラウザへ送る。 */
export async function getFileStream(
  key: string,
): Promise<ReadableStream<Uint8Array> | undefined> {
  validateFileKey(key);
  if (blobEnabled()) {
    const { get } = await import("@vercel/blob");
    const result = await get(key, { access: "private" });
    if (!result?.stream) return undefined;
    return result.stream;
  }
  try {
    const file = await fs.open(
      /* turbopackIgnore: true */ path.join(
        /* turbopackIgnore: true */ localDir(),
        key,
      ),
      "r",
    );
    return Readable.toWeb(
      file.createReadStream(),
    ) as ReadableStream<Uint8Array>;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    return undefined;
  }
}

export async function deleteFiles(keys: string[]) {
  keys.forEach(validateFileKey);
  if (!keys.length) return;
  if (blobEnabled()) {
    const { del } = await import("@vercel/blob");
    await del(keys).catch((err) =>
      console.error("[storage] ファイルを消せませんでした", err),
    );
    return;
  }
  await Promise.all(
    keys.map((k) =>
      fs.rm(path.join(/* turbopackIgnore: true */ localDir(), k), {
        force: true,
      }),
    ),
  );
}
