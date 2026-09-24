// テスト用の PDF を作る
import { PDFDocument, PDFHexString, PDFName, type PDFRef } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

/** 簡単な PDF（Helvetica の英文、1ページ 45 行。1行目は大きな文字の題名） */
export function makePdf(lines: string[], landscape = false) {
  const [w, h] = landscape ? [842, 595] : [595, 842];
  const pages: string[][] = [];
  for (let i = 0; i < lines.length; i += 45) pages.push(lines.slice(i, i + 45));
  if (!pages.length) pages.push([]);
  const objs: string[] = [];
  const add = (o: string) => (objs.push(o), objs.length);
  const catalog = add("");
  const pagesObj = add("");
  const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const kids: number[] = [];
  const esc = (t: string) => t.replace(/[\\()]/g, (c) => "\\" + c);
  for (const [pi, pg] of pages.entries()) {
    const title =
      pi === 0 && pg.length
        ? `BT /F1 20 Tf 50 ${h - 60} Td (${esc(pg[0])}) Tj ET\n`
        : "";
    const body = pg
      .slice(pi === 0 ? 1 : 0)
      .map((l, i) => `BT /F1 9 Tf 50 ${h - 90 - i * 16} Td (${esc(l)}) Tj ET`)
      .join("\n");
    const content = title + body;
    const c = add(
      `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
    );
    kids.push(
      add(
        `<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${c} 0 R >>`,
      ),
    );
  }
  objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
  objs[pagesObj - 1] =
    `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(Buffer.byteLength(out));
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out);
  out +=
    `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` +
    offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out, "latin1");
}

const letters = "abcdefghijklmnopqrstuvwxyz";
const vocab = Array.from({ length: 5000 }, () =>
  Array.from(
    { length: 3 + Math.floor(Math.random() * 7) },
    () => letters[Math.floor(Math.random() * 26)],
  ).join(""),
);
// 同じ研究室の論文は分野の言葉が共通なので、よく出る言葉を混ぜる
const common =
  "model data review comment version paper figure table result method".split(
    " ",
  );
const word = () =>
  Math.random() < 0.3
    ? common[Math.floor(Math.random() * common.length)]
    : vocab[Math.floor(Math.random() * vocab.length)];
export const sentence = () => Array.from({ length: 12 }, word).join(" ") + ".";
export const paper = (n: number) => Array.from({ length: n }, sentence);
export const revise = (lines: string[], ratio: number) =>
  lines.map((l) => (Math.random() < ratio ? sentence() : l));

/** Acrobat やプレビューが書く形と同じ、標準の注釈を入れる（ハイライト＋返信、取り消し線、付箋、手書き） */
export async function annotate(bytes: Buffer) {
  const pdf = await getDocument({
    data: new Uint8Array(bytes),
    isEvalSupported: false,
  }).promise;
  const items = (await (await pdf.getPage(1)).getTextContent()).items as {
    str: string;
    transform: number[];
    width: number;
    height: number;
  }[];
  const lines = items.filter((it) => it.str.length > 20).slice(1, 4);
  const doc = await PDFDocument.load(bytes);
  const ctx = doc.context;
  const annots: PDFRef[] = [];
  const quad = (it: (typeof lines)[0], from = 0, to = 1) => {
    const x1 = it.transform[4] + it.width * from;
    const x2 = it.transform[4] + it.width * to;
    const y1 = it.transform[5] - 2;
    const y2 = it.transform[5] + it.height;
    return { rect: [x1, y1, x2, y2], quads: [x1, y2, x2, y2, x1, y1, x2, y1] };
  };
  const add = (dict: Record<string, unknown>) => {
    const ref = ctx.register(ctx.obj(dict as never));
    annots.push(ref);
    return ref;
  };
  const text = (s: string) => PDFHexString.fromText(s);
  const hl = quad(lines[0], 0, 0.5);
  const parent = add({
    Type: "Annot",
    Subtype: "Highlight",
    Rect: hl.rect,
    QuadPoints: hl.quads,
    T: text("小板 隆浩"),
    Contents: text("ここは言い切ったほうがよい"),
    C: [1, 1, 0],
  });
  add({
    Type: "Annot",
    Subtype: "Text",
    Rect: [hl.rect[2], hl.rect[3], hl.rect[2] + 20, hl.rect[3] + 20],
    IRT: parent,
    T: text("片岡 悠"),
    Contents: text("了解です"),
  });
  const st = quad(lines[1], 0.2, 0.4);
  add({
    Type: "Annot",
    Subtype: "StrikeOut",
    Rect: st.rect,
    QuadPoints: st.quads,
    T: text("小板 隆浩"),
    C: [1, 0, 0],
  });
  add({
    Type: "Annot",
    Subtype: "Text",
    Rect: [60, 700, 80, 720],
    T: text("小板 隆浩"),
    Contents: text("題目をもう少し短く"),
  });
  add({
    Type: "Annot",
    Subtype: "Ink",
    Rect: [300, 400, 380, 440],
    InkList: [[300, 400, 340, 440, 380, 400]],
    T: text(""),
    C: [0, 0, 1],
  });
  doc.getPage(0).node.set(PDFName.of("Annots"), ctx.obj(annots));
  return Buffer.from(await doc.save());
}
