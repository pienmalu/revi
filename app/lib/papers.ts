import * as db from "./repo";
import { reviewStates } from "./review";

import type { PaperSummary } from "./contracts";
export type { PaperSummary } from "./contracts";

/** 一覧と書き出しに使う、原稿1本ぶんのまとめ（状態つき） */
export async function listPapers(): Promise<PaperSummary[]> {
  const [authors, list] = await Promise.all([
    db.allAuthors(),
    db.listDocuments(),
  ]);
  const states = await reviewStates(list, authors);
  return list.map((d) => {
    const state = states.get(d.id)!;
    return {
      ...d,
      authors: authors.get(d.id) ?? [],
      stage: state.stage,
      waiting: state.waiting.length,
      reviewers: state.reviewers.length,
      overdue: state.overdue,
    };
  });
}
