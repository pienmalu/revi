import { requireVersion } from "@/app/lib/documents";
import { handle, HttpError } from "@/app/lib/http";
import { getFile, pdfKey } from "@/app/lib/storage";

export const GET = handle<{ id: string }>(async (req, { id }) => {
  const version = await requireVersion(id);
  const file = await getFile(pdfKey(version.id));
  if (!file) throw new HttpError(404, "PDF が見つかりません");
  const headers: Record<string, string> = {
    "Content-Type": "application/pdf",
    "Cache-Control": "private, max-age=86400, immutable",
  };
  // ?download=1 のときは、送られたときのファイル名で保存させる（ChatGPT などに渡すため）
  if (req.nextUrl.searchParams.get("download"))
    headers["Content-Disposition"] =
      `attachment; filename*=UTF-8''${encodeURIComponent(version.filename)}`;
  return new Response(new Uint8Array(file), { headers });
});
