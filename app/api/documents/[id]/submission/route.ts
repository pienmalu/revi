import { handle, HttpError, json, requireText } from "@/app/lib/http";
import { reportSubmission, undoSubmission } from "@/app/lib/workflow";

// 提出の報告（受領メールのファイルかスクリーンショットを添える）
export const POST = handle<{ id: string }>(async (req, { id }) => {
  const form = await req.formData();
  const file = form.get("receipt");
  if (!(file instanceof File) || !file.size)
    throw new HttpError(
      400,
      "受領メールのファイルかスクリーンショットを添えてください",
    );
  if (file.size > 4 * 1024 * 1024)
    throw new HttpError(400, "受領メールのファイルは 4MB までにしてください");
  const text = (k: string) => {
    const v = form.get(k);
    return typeof v === "string" && v.trim() ? v : undefined;
  };
  const document = await reportSubmission({
    documentId: id,
    by: requireText(form.get("author"), "名前"),
    receipt: {
      buffer: Buffer.from(await file.arrayBuffer()),
      filename: file.name,
      contentType: file.type || "application/octet-stream",
    },
    reason: text("reason"),
  });
  return json({ document }, 201);
});

// 提出の報告を取り消す（まちがえて押したとき）
export const DELETE = handle<{ id: string }>(async (_req, { id }) => {
  await undoSubmission(id);
  return new Response(null, { status: 204 });
});
