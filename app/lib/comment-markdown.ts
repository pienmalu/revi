import type { Comment, Status } from "./contracts";

const labels: Record<Status, string> = {
  open: "未対応",
  resolved: "対応済み",
  wontfix: "見送り",
};
const inline = (text: string) =>
  text.replace(/[\r\n]+/g, " ").replace(/[\\`*_{}\[\]<>#|]/g, "\\$&");
// 投稿内容のMarkdown記号も原文のまま渡し、出力の見出しと混ざらないようにする。
const block = (text: string) => {
  const fence = "`".repeat(
    Math.max(3, ...Array.from(text.matchAll(/`+/g), (m) => m[0].length + 1)),
  );
  return `${fence}text\n${text}\n${fence}`;
};

function location(comment: Comment) {
  if (comment.kind === "general") return "原稿全体";
  const position = comment.position;
  if (!position) return "位置情報なし（引用文と照合してください）";
  const rects = position.rects.length
    ? position.rects
    : [position.boundingRect];
  const pages = [
    ...new Set(
      rects.map((r) => r.pageNumber ?? position.boundingRect.pageNumber),
    ),
  ].sort((a, b) => a - b);
  const lines = [`PDFページ: ${pages.join(", ")}（先頭を1ページ目とする）`];
  if (comment.kind === "area") {
    const r = position.boundingRect;
    if (position.usePdfCoordinates) {
      lines.push(`選択範囲: PDF座標 (${r.x1}, ${r.y1})–(${r.x2}, ${r.y2})`);
    } else if (r.width > 0 && r.height > 0) {
      const pct = (value: number, size: number) =>
        ((100 * value) / size).toFixed(1);
      lines.push(
        `選択範囲: ページ左上を基準に、横 ${pct(r.x1, r.width)}–${pct(r.x2, r.width)}%、縦 ${pct(r.y1, r.height)}–${pct(r.y2, r.height)}%`,
      );
    }
    lines.push(
      "図・表などの範囲指定です。添付PDFの該当位置を確認してください。",
    );
  }
  return lines.join("\n\n");
}

export function commentsToMarkdown(input: {
  title: string;
  version: { number: number; filename: string };
  comments: Comment[];
}) {
  const { title, version, comments } = input;
  const lines = [
    `# ${inline(title)} — コメント`,
    `- 対象PDF: ${inline(version.filename)}\n- 版: v${version.number}\n- コメント: ${comments.length}件（返信は各指摘に併記）\n- 対象: この版の全コメント（画面の絞り込みに関係なく、対応済み・見送りも含む）`,
    "## 修正を依頼するAIへ",
    "このMarkdownと同じ版のPDFを照合し、未対応の指摘と返信を踏まえて修正案を作成してください。対応済み・見送りの指摘は経緯として参照してください。対象箇所を特定できない場合は推測で書き換えず、確認が必要な箇所を示してください。",
  ];
  const sorted = [...comments].sort((a, b) => {
    const ar = a.position?.boundingRect,
      br = b.position?.boundingRect;
    return (
      (ar?.pageNumber ?? 0) - (br?.pageNumber ?? 0) ||
      (ar && ar.height ? ar.y1 / ar.height : 0) -
        (br && br.height ? br.y1 / br.height : 0) ||
      a.created_at.localeCompare(b.created_at)
    );
  });
  function replies(items: Comment[], depth = 1) {
    for (const r of items) {
      lines.push(
        `**返信${depth > 1 ? `（返信への返信・深さ${depth}）` : ""}: ${inline(r.author)}** — ${inline(r.created_at)}`,
        block(r.body),
      );
      replies(r.replies, depth + 1);
    }
  }
  for (const [i, c] of sorted.entries()) {
    lines.push(
      `## 指摘 ${i + 1}`,
      `- 投稿者: ${inline(c.author)}\n- 状態: ${labels[c.status]}\n- 投稿日時: ${inline(c.created_at)}`,
      location(c),
    );
    if (c.quote) lines.push("### 対象の文章", block(c.quote));
    else if (c.kind === "text")
      lines.push("引用文なし。ページとPDFを照合してください。");
    lines.push("### コメント", block(c.body));
    replies(c.replies);
  }
  if (!comments.length) lines.push("この版にはコメントがありません。");
  return lines.join("\n\n") + "\n";
}
