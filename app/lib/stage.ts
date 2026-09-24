// 原稿は提出前・提出済に分ける。スライドは進捗を持たない一覧用の分類。
// 提出前のあいだは、共著者の確認OKが何人そろったかを添える。

export type Stage = "open" | "submitted" | "slides";

export const STAGE_LABEL: Record<Stage, string> = {
  open: "提出前",
  submitted: "提出済",
  slides: "スライド",
};

export type ReviewFacts = {
  layout?: string | null;
  deadline: string | null;
  submitted_at: string | null;
  skip_reason: string | null;
  /** 著者（並びの順の people.id）。先頭が筆頭著者 */
  authorIds: string[];
  /** 最新版に確認OKを出した人（people.id） */
  approved: Set<string>;
};

export type ReviewState = {
  stage: Stage;
  /** 確認OKを出す人（筆頭著者を除く著者） */
  reviewers: string[];
  /** まだ確認OKが無い人 */
  waiting: string[];
  /** 締切を過ぎたのに提出の報告がない */
  overdue: boolean;
  /** 全員の確認OKが無いまま提出した */
  skipped: boolean;
};

/** "YYYY-MM-DD"（日本時間） */
export function todayJst(now = new Date()) {
  return new Date(now.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
}

/** 締切まであと何日か（今日なら 0、過ぎていれば負） */
export function daysUntil(date: string, today = todayJst()) {
  return Math.round((Date.parse(date) - Date.parse(today)) / 86_400_000);
}

/** 確認OKを出す人。筆頭著者（原稿を書いて出す人）を除く共著者全員 */
export const reviewersOf = (authorIds: string[]) => authorIds.slice(1);

export function stageOf(f: ReviewFacts, today = todayJst()): ReviewState {
  if (f.layout === "landscape") {
    return {
      stage: "slides",
      reviewers: [],
      waiting: [],
      overdue: false,
      skipped: false,
    };
  }
  const reviewers = reviewersOf(f.authorIds);
  return {
    stage: f.submitted_at ? "submitted" : "open",
    reviewers,
    waiting: reviewers.filter((id) => !f.approved.has(id)),
    overdue: Boolean(!f.submitted_at && f.deadline && f.deadline < today),
    skipped: Boolean(f.submitted_at && f.skip_reason),
  };
}
