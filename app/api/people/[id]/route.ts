import {
  handle,
  HttpError,
  json,
  optionalText,
  readJson,
} from "@/app/lib/http";
import * as db from "@/app/lib/repo";

// ローマ字の名前を直す（HP の英語の業績と .bib に使う）
export const PATCH = handle<{ id: string }>(async (req, { id }) => {
  if (!(await db.getPerson(id))) throw new HttpError(404, "人が見つかりません");
  const body = await readJson(req);
  await db.setPersonNameEn(id, optionalText(body.name_en));
  return json(await db.getPerson(id));
});
