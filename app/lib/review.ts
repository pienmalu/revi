// 共著者の確認OKと提出の記録を集めて、状態（stage.ts）を決める
import * as db from "./repo";
import { stageOf, type ReviewState } from "./stage";

type DocFacts = Pick<
  db.DocumentRow,
  "id" | "deadline" | "submitted_at" | "skip_reason"
>;

/** 1本の原稿の状態と、確認OKを出す人の顔ぶれ */
export async function reviewOf(document: DocFacts, authors?: db.Author[]) {
  const latest = await db.latestVersion(document.id);
  const answers = latest ? await db.approvalsFor(latest.id) : [];
  authors ??= await db.listAuthors(document.id);
  const approved = new Set(answers.map((a) => a.person_id));
  const state = stageOf({
    ...document,
    layout: latest?.layout,
    authorIds: authors.map((a) => a.id),
    approved,
  });
  const nameOf = new Map(authors.map((a) => [a.id, a.name]));
  return {
    ...state,
    latest,
    /** 確認OKを出す人と、出したかどうか（著者の順） */
    people: state.reviewers.map((id) => ({
      id,
      name: nameOf.get(id) ?? "",
      ok: approved.has(id),
    })),
  };
}

export type Review = Awaited<ReturnType<typeof reviewOf>>;

/** 一覧のすべての原稿の状態（まとめて引く） */
export async function reviewStates(
  list: (DocFacts & {
    latest_version_id: string | null;
    latest_layout: string | null;
  })[],
  authors: Map<string, db.Author[]>,
): Promise<Map<string, ReviewState>> {
  const latestIds = list
    .map((d) => d.latest_version_id)
    .filter((id): id is string => Boolean(id));
  const approved = new Map<string, Set<string>>();
  if (latestIds.length) {
    const answers = await db.approvalsForVersions(latestIds);
    for (const a of answers) {
      if (!approved.has(a.version_id)) approved.set(a.version_id, new Set());
      approved.get(a.version_id)!.add(a.person_id);
    }
  }
  return new Map(
    list.map((d) => [
      d.id,
      stageOf({
        ...d,
        layout: d.latest_layout,
        authorIds: (authors.get(d.id) ?? []).map((a) => a.id),
        approved:
          (d.latest_version_id && approved.get(d.latest_version_id)) ||
          new Set(),
      }),
    ]),
  );
}
