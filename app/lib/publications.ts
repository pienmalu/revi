// 業績リスト。提出した原稿（不採録を除く）から作る。
// - HP の形：「論文・国際会議」と「研究会・シンポジウム他」の2節。
//   英語の原稿と論文誌は「論文・国際会議」、日本語の発表は「研究会・シンポジウム他」。英語の原稿は英語の書き方、日本語は日本語の書き方
// - 修論・卒論の研究業績欄の形：BibTeX（.bib）。LaTeX に貼れば番号付きで並ぶ
// 年の区切りは暦年（1〜12月）。HP の区切りが年度だと分かったら YEAR_START_MONTH を 4 にする。

import * as db from "./repo";

/** 年の始まりの月（1 なら暦年、4 なら年度） */
export const YEAR_START_MONTH = 1;

const MONTHS_EN = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const MONTHS_BIB = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
];

/** 提出先の名前から、論文誌かどうかを見分ける */
const JOURNAL = /journal|transactions|letters|論文誌|学会誌/i;

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;

export type Publication = {
  id: string;
  title: string;
  authors: { id: string; name: string; name_en: string | null }[];
  venue: string;
  journal: boolean;
  volume: string | null;
  number: string | null;
  pages: string | null;
  paper_no: string | null;
  note: string | null;
  /** 発表の年月（YYYY-MM）。入っていなければ締切の年月 */
  month: string | null;
  /** HP の節 */
  section: "papers" | "talks";
  japanese: boolean;
};

export const SECTION_LABEL = {
  papers: "論文・国際会議",
  talks: "研究会・シンポジウム他",
} as const;

/** 暦年（または年度）の数え方での年 */
export function yearOf(month: string) {
  const [y, m] = month.split("-").map(Number);
  return m >= YEAR_START_MONTH ? y : y - 1;
}

/** 業績に入る原稿（古い順） */
export async function listPublications(): Promise<Publication[]> {
  const out: Publication[] = [];
  for (const d of await db.documentsIn()) {
    if (!d.submitted_at || d.rejected) continue;
    if ((await db.latestVersion(d.id))?.layout === "landscape") continue;
    const authors = await db.listAuthorPeople(d.id);
    const journal = JOURNAL.test(d.venue ?? "");
    const japanese = CJK.test(d.title);
    out.push({
      id: d.id,
      title: d.title,
      authors: authors.map((a) => ({
        id: a.id,
        name: a.name,
        name_en: a.name_en,
      })),
      venue: d.venue ?? "",
      journal,
      volume: d.volume,
      number: d.number,
      pages: d.pages,
      paper_no: d.paper_no,
      note: d.note,
      month: d.published_month ?? d.deadline?.slice(0, 7) ?? null,
      section: journal || !japanese ? "papers" : "talks",
      japanese,
    });
  }
  return out.sort((a, b) => (a.month ?? "").localeCompare(b.month ?? ""));
}

const join = (parts: (string | null | undefined | false)[]) =>
  parts.filter(Boolean).join(", ");
const range = (pages: string) => pages.replace(/\s*[-–—~〜]+\s*/g, "-");

/** 英語の名前（ローマ字が無ければ入っている名前） */
const enName = (a: Publication["authors"][number]) => a.name_en || a.name;
/** 日本語の名前（HP では姓と名のあいだの空白を詰める） */
const jaName = (a: Publication["authors"][number]) =>
  a.name.replace(/\s+/g, CJK.test(a.name) ? "" : " ");

/** HP の1行 */
export function hpLine(p: Publication) {
  const [y, m] = (p.month ?? "").split("-").map(Number);
  if (!p.japanese) {
    const venue = p.journal
      ? p.venue
      : p.venue && `the proceedings of ${p.venue}`;
    return `${join([
      p.title,
      ...p.authors.map(enName),
      venue,
      p.volume && `Vol. ${p.volume}`,
      p.number && `No. ${p.number}`,
      p.pages && `pp. ${range(p.pages)}`,
      p.paper_no,
      y && m ? `${MONTHS_EN[m - 1]}, ${y}` : y ? String(y) : null,
    ])}.`;
  }
  return join([
    p.title,
    ...p.authors.map(jaName),
    p.venue,
    p.volume && `Vol. ${p.volume}`,
    p.number && `No. ${p.number}`,
    p.pages && `pp. ${range(p.pages)}`,
    p.paper_no,
    y && m ? `${y}年${m}月` : y ? `${y}年` : null,
  ]);
}

/** HP の業績リスト（その年の分）。節ごとに番号を付けた文 */
export function hpText(list: Publication[], year: number) {
  const inYear = list.filter((p) => p.month && yearOf(p.month) === year);
  const sections = (["papers", "talks"] as const).map((s) => {
    const items = inYear.filter((p) => p.section === s);
    if (!items.length) return "";
    return `${SECTION_LABEL[s]}\n${items.map((p, i) => `${i + 1}. ${hpLine(p)}`).join("\n")}`;
  });
  return sections.filter(Boolean).join("\n\n");
}

const bibEscape = (s: string) => s.replace(/([{}])/g, "\\$1");

/** BibTeX の1件。修論の研究業績欄（谷津さんの例）と同じ並びになるように書く */
export function bibEntry(p: Publication) {
  const [y, m] = (p.month ?? "").split("-").map(Number);
  const names = p.authors.map((a) => (p.japanese ? jaName(a) : enName(a)));
  const type = p.journal ? "article" : "inproceedings";
  const fields: [string, string | undefined][] = [
    ["author", names.join(" and ")],
    ["title", p.title],
    [type === "article" ? "journal" : "booktitle", p.venue || undefined],
    ["volume", p.volume ?? undefined],
    ["number", p.number ?? undefined],
    ["pages", p.pages ? range(p.pages).replace("-", "--") : undefined],
    ["year", y ? String(y) : undefined],
    ["note", [p.paper_no, p.note].filter(Boolean).join(". ") || undefined],
  ];
  const lines = fields
    .filter(([, v]) => v)
    .map(([k, v]) => `  ${k} = {${bibEscape(v!)}},`);
  // 月は BibTeX の決まった書き方（{} で囲まない）にすると、正しく "Sep." などと出る
  if (m) lines.push(`  month = ${MONTHS_BIB[m - 1]},`);
  return `@${type}{lr-${p.id},\n${lines.join("\n")}\n}`;
}

/** その人が著者に入っている業績の .bib（古い順） */
export function bibFor(list: Publication[], personId: string) {
  return list
    .filter((p) => p.authors.some((a) => a.id === personId))
    .map(bibEntry)
    .join("\n\n");
}
