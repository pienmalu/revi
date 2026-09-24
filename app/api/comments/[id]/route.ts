import type { Comment } from "@/app/lib/contracts";
import { handle, HttpError, json, readJson, requireText } from "@/app/lib/http";
import * as db from "@/app/lib/repo";

type Params = { id: string };
const STATUSES = new Set(["open", "resolved", "wontfix"]);

export const PATCH = handle<Params>(async (req, { id }) => {
  const { body, status } = await readJson(req);
  if (status !== undefined && !STATUSES.has(status as string))
    throw new HttpError(400, "状態の値が不正です");
  const updated = await db.updateComment(id, {
    body: body === undefined ? undefined : requireText(body, "コメント"),
    status: status as db.Status | undefined,
  });
  if (!updated) throw new HttpError(404, "コメントが見つかりません");
  return json<Comment>(updated);
});

export const DELETE = handle<Params>(async (_req, { id }) => {
  if (!(await db.deleteComment(id)))
    throw new HttpError(404, "コメントが見つかりません");
  return new Response(null, { status: 204 });
});
