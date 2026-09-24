import { handle, HttpError } from "@/app/lib/http";
import * as db from "@/app/lib/repo";
import { copyKey, getFile } from "@/app/lib/storage";

// 共著者が送った書き込みPDF（手書きなど、コメントに取り込めない書き込みを見るため）
export const GET = handle<{ id: string }>(async (_req, { id }) => {
  const copy = await db.getCopy(id);
  const file = copy && (await getFile(copyKey(copy.id)));
  if (!file) throw new HttpError(404, "書き込みPDFが見つかりません");
  return new Response(new Uint8Array(file), {
    headers: { "Content-Type": "application/pdf" },
  });
});
