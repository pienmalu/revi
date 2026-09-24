// API で共通に使う、原稿まわりの確かめ方
import { HttpError, optionalDate, optionalMonth, optionalText } from "./http";
import * as db from "./repo";

export async function requireDocument(id: string) {
  const document = await db.getDocument(id);
  if (!document) throw new HttpError(404, "原稿が見つかりません");
  return document;
}

export async function requireVersion(id: string) {
  const version = await db.getVersion(id);
  if (!version) throw new HttpError(404, "版が見つかりません");
  return version;
}

/** 画面から直せる項目。送られてきた項目だけを直す */
export function paperFields(
  body: Record<string, unknown>,
): Partial<db.PaperFields> {
  const patch: Partial<db.PaperFields> = {};
  for (const f of [
    "venue",
    "volume",
    "number",
    "pages",
    "paper_no",
    "note",
  ] as const) {
    if (body[f] !== undefined) patch[f] = optionalText(body[f]);
  }
  if (body.rejected !== undefined) patch.rejected = body.rejected ? 1 : 0;
  if (body.deadline !== undefined)
    patch.deadline = optionalDate(body.deadline, "締切");
  if (body.published_month !== undefined)
    patch.published_month = optionalMonth(body.published_month, "発表の年月");
  return patch;
}
