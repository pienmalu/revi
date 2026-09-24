import type { UploadResult, PaperSummary } from "@/app/lib/contracts";
import { ingestPdf } from "@/app/lib/ingest";
import { handle, HttpError, json, readJson } from "@/app/lib/http";
import { listPapers } from "@/app/lib/papers";
import * as db from "@/app/lib/repo";
import { deleteFiles, getFile } from "@/app/lib/storage";

export const maxDuration = 60;

export const GET = handle(async () => json<PaperSummary[]>(await listPapers()));

/**
 * PDF を登録する。送り方は2つ。
 * - multipart/form-data の file（手元の開発。Vercel では 4.5MB までしか送れない）
 * - JSON の uploaded（ブラウザが Vercel Blob に直接送った置き場所）
 */
export const POST = handle(async (req) => {
  let buffer: Buffer;
  let filename: string;
  let author: string | undefined;
  let documentId: string | undefined;
  let uploaded: string | undefined;
  if (req.headers.get("content-type")?.includes("multipart/form-data")) {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File))
      throw new HttpError(400, "PDF を選んでください");
    buffer = Buffer.from(await file.arrayBuffer());
    filename = file.name;
    author = (form.get("author") as string | null) || undefined;
    documentId = (form.get("documentId") as string | null) || undefined;
  } else {
    const body = await readJson(req);
    uploaded = typeof body.uploaded === "string" ? body.uploaded : undefined;
    if (!uploaded?.startsWith("uploads/"))
      throw new HttpError(400, "PDF を選んでください");
    const file = await getFile(uploaded);
    if (!file) throw new HttpError(400, "送った PDF が見つかりません");
    buffer = file;
    filename =
      typeof body.filename === "string" ? body.filename : "untitled.pdf";
    author = typeof body.author === "string" ? body.author : undefined;
    documentId =
      typeof body.documentId === "string" ? body.documentId : undefined;
  }
  try {
    const result = await ingestPdf({
      buffer,
      filename,
      uploadedBy: author,
      uploaderId: author ? (await db.findPersonByName(author))?.id : undefined,
      documentId,
    });
    const { fingerprint: _, ...version } = result.version; // 本文の指紋は画面では使わない
    return json<UploadResult>({ ...result, version }, 201);
  } finally {
    // Blob に一時的に置いた PDF は、登録したら（失敗しても）消す
    if (uploaded) await deleteFiles([uploaded]);
  }
});
