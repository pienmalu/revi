import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { handle, json, readJson } from "@/app/lib/http";

// Vercel Blob を使うとき、ブラウザが PDF を直接 Blob に送るための「一度だけ使える許可」を出す。
// 送り終えたら、ブラウザが /api/documents に置き場所を知らせて登録する。
export const POST = handle(async (req) => {
  const body = (await readJson(req)) as unknown as HandleUploadBody;
  const result = await handleUpload({
    body,
    request: req,
    onBeforeGenerateToken: async (pathname) => {
      if (!pathname.startsWith("uploads/")) throw new Error("送り先が不正です");
      return {
        allowedContentTypes: ["application/pdf"],
        maximumSizeInBytes: 100 * 1024 * 1024,
        addRandomSuffix: true,
      };
    },
  });
  return json(result);
});
