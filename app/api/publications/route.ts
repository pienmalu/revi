import { handle, json } from "@/app/lib/http";
import {
  hpLine,
  hpText,
  listPublications,
  SECTION_LABEL,
  yearOf,
} from "@/app/lib/publications";

// HP の業績リスト。?year= の年の分を、コピーできる文と、1件ずつの形で返す（あとで HP から読めるように）
export const GET = handle(async (req) => {
  const list = await listPublications();
  const years = [
    ...new Set(list.filter((p) => p.month).map((p) => yearOf(p.month!))),
  ].sort((a, b) => b - a);
  const year =
    Number(req.nextUrl.searchParams.get("year")) ||
    years[0] ||
    new Date().getFullYear();
  const items = list
    .filter((p) => p.month && yearOf(p.month) === year)
    .map((p) => ({
      id: p.id,
      section: SECTION_LABEL[p.section],
      text: hpLine(p),
    }));
  return json({
    year,
    years,
    text: hpText(list, year),
    items,
    undated: list.filter((p) => !p.month).map((p) => p.title),
  });
});
