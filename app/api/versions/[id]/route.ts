import * as documentActions from "@/app/lib/document-actions";
import { handle, HttpError, json } from "@/app/lib/http";

export const DELETE = handle<{ id: string }>(async (_req, { id }) => {
  const result = await documentActions.deleteVersion(id);
  if (!result) throw new HttpError(404, "版が見つかりません");
  return json(result);
});
