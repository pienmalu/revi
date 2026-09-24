import type { PaperSummary } from "./api";
export { STAGE_LABEL, type Stage } from "@/app/lib/stage";

/** 一覧の年（暦年）。発表の年月、無ければ締切、無ければ最後に更新した日で数える */
export function yearOf(
  p: Pick<PaperSummary, "published_month" | "deadline" | "updated_at">,
) {
  return Number((p.published_month ?? p.deadline ?? p.updated_at).slice(0, 4));
}

/** 一覧用の短い形。今年なら "7/10"、ほかの年なら "2025/7/10" */
export function formatShort(date: string | null, today = new Date()) {
  if (!date) return "";
  const [y, m, d] = date.split("-").map(Number);
  return y === today.getFullYear() ? `${m}/${d}` : `${y}/${m}/${d}`;
}

/** 締切まであと何日か（今日なら 0、過ぎていれば負） */
export function daysLeft(deadline: string, today = new Date()) {
  const [y, m, d] = deadline.split("-").map(Number);
  const start = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  );
  return Math.round(
    (new Date(y, m - 1, d).getTime() - start.getTime()) / 86_400_000,
  );
}
