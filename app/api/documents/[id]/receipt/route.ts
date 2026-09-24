import { requireDocument } from "@/app/lib/documents";
import { handle, HttpError } from "@/app/lib/http";
import { getFileStream } from "@/app/lib/storage";

// 提出の報告に添えた受領メール
export const GET = handle<{ id: string }>(async (_req, { id }) => {
  const document = await requireDocument(id);
  const file = document.receipt_key
    ? await getFileStream(document.receipt_key)
    : undefined;
  if (!file) throw new HttpError(404, "受領メールが見つかりません");
  const name = document.receipt_name ?? "receipt";
  const type = /\.pdf$/i.test(name)
    ? "application/pdf"
    : /\.(png|jpe?g|gif|webp)$/i.test(name)
      ? `image/${name.split(".").pop()!.toLowerCase().replace("jpg", "jpeg")}`
      : "application/octet-stream";
  return new Response(file, {
    headers: {
      "Content-Type": type,
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(name)}`,
    },
  });
});
