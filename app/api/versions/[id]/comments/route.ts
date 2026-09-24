import type { Comment } from "@/app/lib/contracts";
import { requireVersion } from "@/app/lib/documents";
import { handle, HttpError, json, readJson, requireText } from "@/app/lib/http";
import * as db from "@/app/lib/repo";

type Params = { id: string };

export const GET = handle<Params>(async (_req, { id }) =>
  json<Comment[]>(await db.listComments(id)),
);

export const POST = handle<Params>(async (req, { id }) => {
  await requireVersion(id);
  const body = await readJson(req);
  const { parentId, kind, quote, position } = body as {
    parentId?: string;
    kind?: string;
    quote?: unknown;
    position?: unknown;
  };
  if (parentId) {
    const parent = await db.getComment(parentId);
    if (!parent || parent.version_id !== id)
      throw new HttpError(400, "返信先が見つかりません");
  } else if (
    kind !== "general" &&
    (!position || (kind !== "text" && kind !== "area"))
  ) {
    // 全体へのコメント（AI の添削結果やリンクを貼るときなど）は、場所がいらない
    throw new HttpError(400, "コメントする場所を選んでください");
  }
  const comment = await db.createComment({
    versionId: id,
    parentId,
    author: requireText(body.author, "名前"),
    body: requireText(body.body, "コメント"),
    kind: kind as "text" | "area" | "general" | undefined,
    quote: typeof quote === "string" ? quote : undefined,
    position:
      kind === "general" ? undefined : (position as Comment["position"]),
  });
  return json<Comment>(comment, 201);
});
