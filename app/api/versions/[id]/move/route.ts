import * as documentActions from "@/app/lib/document-actions";
import { requireVersion } from "@/app/lib/documents";
import { handle, HttpError, json, readJson } from "@/app/lib/http";
import * as db from "@/app/lib/repo";

// 版を別の原稿へ移す。documentId が無ければ、新しい原稿として切り離す
export const POST = handle<{ id: string }>(async (req, { id }) => {
  const version = await requireVersion(id);
  const target = (await readJson(req)).documentId;
  if (target !== undefined && !(await db.getDocument(String(target))))
    throw new HttpError(404, "移し先の原稿が見つかりません");
  if (target === version.document_id)
    throw new HttpError(400, "すでにこの原稿の版です");
  const moved =
    target === undefined
      ? await documentActions.splitVersion(id)
      : await documentActions.moveVersion(id, String(target));
  return json({ documentId: moved!.document_id, number: moved!.number });
});
