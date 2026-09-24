import { requireDocument } from "@/app/lib/documents";
import { handle, HttpError, json, readJson, requireText } from "@/app/lib/http";
import { redetectAuthors } from "@/app/lib/ingest";
import * as db from "@/app/lib/repo";

// 著者を並びの順に入れ直す。人の ID か、名前（知らない名前なら人を新しく作る）で指定する
export const PUT = handle<{ id: string }>(async (req, { id }) => {
  await requireDocument(id);
  const body = await readJson(req);
  const list = Array.isArray(body.authors)
    ? (body.authors as { id?: string; name?: string }[])
    : null;
  if (!list) throw new HttpError(400, "著者の一覧がありません");
  const ids: string[] = [];
  for (const a of list) {
    if (a.id) {
      if (!(await db.getPerson(a.id)))
        throw new HttpError(404, "著者が見つかりません");
      ids.push(a.id);
    } else {
      ids.push(
        (await db.findOrCreatePerson(requireText(a.name, "著者の名前"))).id,
      );
    }
  }
  await db.setAuthors(id, ids, true);
  await redetectAuthors(); // 新しく覚えた人を、ほかの原稿でも探す
  return json(await db.listAuthors(id));
});
