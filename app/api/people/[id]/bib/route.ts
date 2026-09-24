import { handle, HttpError } from "@/app/lib/http";
import { bibFor, listPublications } from "@/app/lib/publications";
import * as db from "@/app/lib/repo";

// その人の研究業績（修論・卒論に貼る .bib）
export const GET = handle<{ id: string }>(async (_req, { id }) => {
  const person = await db.getPerson(id);
  if (!person) throw new HttpError(404, "人が見つかりません");
  const bib = bibFor(await listPublications(), id);
  return new Response(
    `% ${person.name} の研究業績（れびから書き出し）\n\n${bib}\n`,
    {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`研究業績_${person.name.replace(/\s+/g, "")}.bib`)}`,
      },
    },
  );
});
