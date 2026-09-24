import { commentsToMarkdown } from "@/app/lib/comment-markdown";
import { requireDocument, requireVersion } from "@/app/lib/documents";
import { handle } from "@/app/lib/http";
import { listComments } from "@/app/lib/repo";

export const GET = handle<{ id: string }>(async (_req, { id }) => {
  const version = await requireVersion(id);
  const [document, comments] = await Promise.all([
    requireDocument(version.document_id),
    listComments(id),
  ]);
  const stem =
    version.filename
      .replace(/\.pdf$/i, "")
      .replace(/[\x00-\x1f\x7f/\\]/g, "_")
      .slice(0, 100) || "原稿";
  const filename = `${stem}_v${version.number}_コメント.md`;
  return new Response(
    commentsToMarkdown({ title: document.title, version, comments }),
    {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
});
