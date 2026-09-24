import { handle } from "@/app/lib/http";
import * as db from "@/app/lib/repo";

// 「この原稿の版かもしれない」の提案を閉じる
export const DELETE = handle<{ id: string }>(async (_req, { id }) => {
  await db.setSuggestion(id, null);
  return new Response(null, { status: 204 });
});
