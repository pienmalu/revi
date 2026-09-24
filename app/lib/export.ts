import ExcelJS from "exceljs";
import type { PaperSummary } from "./papers";

const COLUMNS: {
  header: string;
  width: number;
  value(p: PaperSummary): string | number;
}[] = [
  { header: "題名", width: 60, value: (p) => p.title },
  {
    header: "著者",
    width: 40,
    value: (p) => p.authors.map((a) => a.name).join(", "),
  },
  { header: "筆頭著者", width: 16, value: (p) => p.authors[0]?.name ?? "" },
  {
    header: "提出先",
    width: 36,
    value: (p) => (p.stage === "slides" ? "" : (p.venue ?? "")),
  },
  {
    header: "締切",
    width: 12,
    value: (p) => (p.stage === "slides" ? "" : (p.deadline ?? "")),
  },
  {
    header: "最新の版",
    width: 10,
    value: (p) => (p.latest_version ? `v${p.latest_version}` : ""),
  },
  { header: "未対応のコメント", width: 16, value: (p) => p.open_count },
  { header: "更新日", width: 12, value: (p) => p.updated_at.slice(0, 10) },
];

const csvCell = (v: string | number) => {
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv(papers: PaperSummary[]) {
  const lines = [
    COLUMNS.map((c) => c.header),
    ...papers.map((p) => COLUMNS.map((c) => c.value(p))),
  ];
  // 先頭の BOM が無いと、Excel で開いたときに日本語が文字化けする
  return (
    "\uFEFF" +
    lines.map((row) => row.map(csvCell).join(",")).join("\r\n") +
    "\r\n"
  );
}

export async function toXlsx(papers: PaperSummary[]) {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("原稿");
  sheet.columns = COLUMNS.map((c) => ({ header: c.header, width: c.width }));
  for (const p of papers) sheet.addRow(COLUMNS.map((c) => c.value(p)));
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: COLUMNS.length },
  };
  return Buffer.from(await book.xlsx.writeBuffer());
}
