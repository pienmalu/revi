import { toCsv, toXlsx } from "@/app/lib/export";
import { handle, readJson } from "@/app/lib/http";
import { listPapers } from "@/app/lib/papers";

// 一覧で絞り込んだ原稿を、画面の並びのまま CSV / Excel にする
export const POST = handle(async (req) => {
  const body = await readJson(req);
  const ids: string[] = Array.isArray(body.ids) ? (body.ids as string[]) : [];
  const byId = new Map((await listPapers()).map((p) => [p.id, p]));
  const papers = ids.map((id) => byId.get(id)).filter((p) => p !== undefined);
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const name = (ext: string) =>
    `attachment; filename*=UTF-8''${encodeURIComponent(`原稿_${stamp}.${ext}`)}`;
  if (body.format === "xlsx") {
    return new Response(new Uint8Array(await toXlsx(papers)), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": name("xlsx"),
      },
    });
  }
  return new Response(toCsv(papers), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": name("csv"),
    },
  });
});
