import * as documentActions from "@/app/lib/document-actions";
import type { DocumentDetail } from "@/app/lib/contracts";
import { paperFields, requireDocument } from "@/app/lib/documents";
import { handle, HttpError, json, readJson } from "@/app/lib/http";
import * as db from "@/app/lib/repo";
import { reviewOf } from "@/app/lib/review";
import { threadUrl } from "@/app/lib/slack/core";

type Params = { id: string };

export const GET = handle<Params>(async (_req, { id }) => {
  const document = await requireDocument(id);
  const [authors, versions, slackUrl] = await Promise.all([
    db.listAuthors(id),
    db.listVersions(id),
    threadUrl(document),
  ]);
  const { latest: _, ...review } = await reviewOf(document, authors);
  return json<DocumentDetail>({
    document: { ...document, slack_url: slackUrl },
    versions,
    authors,
    review,
  });
});

// 題名と、提出先・締切などを直す。送られてきた項目だけを変える
export const PATCH = handle<Params>(async (req, { id }) => {
  await requireDocument(id);
  const body = await readJson(req);
  if (typeof body.title === "string")
    await documentActions.setDocumentTitle(id, body.title.trim());
  await db.updatePaper(id, paperFields(body));
  return json({ document: await db.getDocument(id) });
});

export const DELETE = handle<Params>(async (_req, { id }) => {
  if (!(await documentActions.deleteDocument(id)))
    throw new HttpError(404, "原稿が見つかりません");
  return new Response(null, { status: 204 });
});
