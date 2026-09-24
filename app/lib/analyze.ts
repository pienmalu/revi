import path from "node:path";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { TextItem } from "pdfjs-dist/types/src/display/api";

// 文字の対応表と標準フォントの場所。Next.js は server のコードをまとめ直すので、置き場所は作業場所から数える
const pdfjsDir = path.join(process.cwd(), "node_modules", "pdfjs-dist");

export type Layout = "portrait" | "landscape";

export type PdfAnalysis = {
  /** 1ページ目でいちばん大きな文字の行（論文やスライドの題名） */
  title?: string;
  /** 縦長なら論文、横長ならスライドとみなす */
  layout: Layout;
  /** 本文の指紋。文字がほとんど無い（画像だけの）PDFでは null */
  fingerprint: Uint32Array | null;
  /** 1ページ目の頭（題名から概要の前まで）。著者を探すのに使う */
  header: string;
  /** 書き込み（Acrobat やプレビューなどで付けた注釈） */
  annotations: PdfAnnotation[];
};

/** 画面のコメントと同じ形の位置（ページの幅・高さに対する座標。左上が原点） */
type Scaled = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  width: number;
  height: number;
  pageNumber: number;
};
export type AnnotationPosition = { boundingRect: Scaled; rects: Scaled[] };

export type PdfAnnotation = {
  /** 同じ書き込みかどうかを見分ける目印（ページ・種類・場所・内容） */
  key: string;
  /** PDF の中での番号。返信の親を探すのに使う */
  ref: string;
  inReplyTo: string | null;
  subtype: string;
  author: string;
  contents: string;
  /** なぞった文字（ハイライトなど） */
  quote: string;
  /** 文字に付いた書き込みか、場所に付いた書き込みか */
  kind: "text" | "area";
  position: AnnotationPosition;
};

// 文字をなぞる書き込み
const TEXT_MARKUP = new Set([
  "Highlight",
  "Underline",
  "Squiggly",
  "StrikeOut",
]);
// 場所に付ける書き込み（付箋・文字・図形・手書き・挿入の印・スタンプ）
const AREA_MARKUP = new Set([
  "Text",
  "FreeText",
  "Square",
  "Circle",
  "Line",
  "Polygon",
  "PolyLine",
  "Ink",
  "Caret",
  "Stamp",
]);

export class PdfReadError extends Error {}

const MAX_PAGES = 60;
const SHINGLE = 8; // 何文字ずつ区切って比べるか
const SAMPLE = 16; // 指紋を小さくするため、区切りの 1/16 だけを残す
const MIN_HASHES = 30; // これより少ない指紋は比べても当てにならない

export async function analyzePdf(buffer: Buffer): Promise<PdfAnalysis> {
  let pdf;
  try {
    pdf = await getDocument({
      data: new Uint8Array(buffer),
      cMapUrl: path.join(pdfjsDir, "cmaps") + path.sep,
      cMapPacked: true,
      standardFontDataUrl: path.join(pdfjsDir, "standard_fonts") + path.sep,
      isEvalSupported: false,
    }).promise;
  } catch (err) {
    if ((err as Error).name === "PasswordException")
      throw new PdfReadError("パスワード付きのPDFは登録できません");
    throw new PdfReadError("PDFを読み取れませんでした");
  }
  try {
    const first = await pdf.getPage(1);
    const { width, height } = first.getViewport({ scale: 1 });
    let text = "";
    let title: string | undefined;
    let header = "";
    const annotations: PdfAnnotation[] = [];
    for (let i = 1; i <= Math.min(pdf.numPages, MAX_PAGES); i++) {
      const page = i === 1 ? first : await pdf.getPage(i);
      const items = (await page.getTextContent()).items.filter(
        (it): it is TextItem => "str" in it,
      );
      if (i === 1) {
        title = largestLine(items);
        header = headerOf(items);
      }
      text += items.map((it) => it.str).join("");
      annotations.push(
        ...annotationsOf(
          await page.getAnnotations(),
          items,
          page.getViewport({ scale: 1 }),
          i,
        ),
      );
    }
    return {
      title,
      layout: width > height ? "landscape" : "portrait",
      fingerprint: fingerprintOf(text),
      header,
      annotations,
    };
  } finally {
    await pdf.destroy();
  }
}

/** いちばん大きな文字が続く最初のまとまりを題名とみなす */
function largestLine(items: TextItem[]): string | undefined {
  const sized = items
    .filter((it) => it.str.trim())
    .map((it) => ({
      str: it.str.trim(),
      size: Math.hypot(it.transform[2], it.transform[3]),
    }));
  const sizes = [...new Set(sized.map((it) => Math.round(it.size)))].sort(
    (a, b) => b - a,
  );
  for (const size of sizes.slice(0, 3)) {
    const parts: string[] = [];
    for (const it of sized) {
      if (Math.round(it.size) >= size) parts.push(it.str);
      else if (parts.length) break;
    }
    const joined = parts.reduce(
      (acc, s) =>
        /[A-Za-z0-9]$/.test(acc) && /^[A-Za-z0-9]/.test(s)
          ? `${acc} ${s}`
          : acc + s,
      "",
    );
    // ページ番号や飾りの大きな1文字は題名にしない
    if (joined.length >= 6) return joined.slice(0, 200);
  }
  return undefined;
}

type RawAnnotation = {
  id: string;
  subtype: string;
  rect: number[];
  quadPoints?: ArrayLike<number>;
  titleObj?: { str: string };
  contentsObj?: { str: string };
  inReplyTo?: string;
};
type Viewport = {
  width: number;
  height: number;
  convertToViewportRectangle(rect: number[]): number[];
};

/** PDF の座標（左下が原点）の四角を、画面のコメントと同じ形にする */
function toScaled(
  rect: number[],
  viewport: Viewport,
  pageNumber: number,
): Scaled {
  const [a, b, c, d] = viewport.convertToViewportRectangle(rect);
  return {
    x1: Math.min(a, c),
    y1: Math.min(b, d),
    x2: Math.max(a, c),
    y2: Math.max(b, d),
    width: viewport.width,
    height: viewport.height,
    pageNumber,
  };
}

/** なぞった範囲（4点ずつの組）を、PDF の座標の四角にする */
function quadRects(q: ArrayLike<number>) {
  const rects: number[][] = [];
  for (let i = 0; i + 7 < q.length; i += 8) {
    const xs = [q[i], q[i + 2], q[i + 4], q[i + 6]];
    const ys = [q[i + 1], q[i + 3], q[i + 5], q[i + 7]];
    rects.push([
      Math.min(...xs),
      Math.min(...ys),
      Math.max(...xs),
      Math.max(...ys),
    ]);
  }
  return rects;
}

/** なぞった範囲にある文字を拾う。行の一部だけをなぞったときは、横の位置で切り出す */
function quoteOf(rects: number[][], items: TextItem[]) {
  const parts: string[] = [];
  for (const [x1, y1, x2, y2] of rects) {
    for (const it of items) {
      if (!it.str.trim() || !it.width) continue;
      const x = it.transform[4];
      const mid = it.transform[5] + it.height / 2;
      if (mid < y1 || mid > y2 || x + it.width < x1 || x > x2) continue;
      const from = Math.max(0, (x1 - x) / it.width);
      const to = Math.min(1, (x2 - x) / it.width);
      parts.push(
        it.str.slice(
          Math.round(from * it.str.length),
          Math.round(to * it.str.length),
        ),
      );
    }
  }
  return parts.join("").replace(/\s+/g, " ").trim();
}

function annotationsOf(
  raw: unknown[],
  items: TextItem[],
  viewport: Viewport,
  pageNumber: number,
): PdfAnnotation[] {
  const out: PdfAnnotation[] = [];
  for (const a of raw as RawAnnotation[]) {
    const markup = TEXT_MARKUP.has(a.subtype);
    if (!markup && !AREA_MARKUP.has(a.subtype)) continue; // リンクや入力欄などは書き込みではない
    const pdfRects =
      markup && a.quadPoints ? quadRects(a.quadPoints) : [a.rect];
    const rects = pdfRects.map((r) => toScaled(r, viewport, pageNumber));
    const contents = a.contentsObj?.str.trim() ?? "";
    const r = a.rect.map((n) => Math.round(n));
    out.push({
      key: `${pageNumber}:${a.subtype}:${r.join(",")}:${contents.slice(0, 40)}`,
      ref: a.id,
      inReplyTo: a.inReplyTo ?? null,
      subtype: a.subtype,
      author: a.titleObj?.str.trim() ?? "",
      contents,
      quote: markup ? quoteOf(pdfRects, items) : "",
      kind: markup ? "text" : "area",
      position: {
        boundingRect: toScaled(a.rect, viewport, pageNumber),
        rects: markup ? rects : [],
      },
    });
  }
  return out;
}

// 著者の行は、題名と概要（はじめに）のあいだにある
const BODY_START =
  /^\s*(abstract|概要|要旨|あらまし|summary|keywords?|1\.?\s*(introduction|はじめに|まえがき)|はじめに|まえがき)/i;
const HEADER_LINES = 14;

/** 1ページ目を上から行にまとめ、本文が始まる前までを返す */
function headerOf(items: TextItem[]): string {
  const lines: { y: number; parts: string[] }[] = [];
  for (const it of items) {
    if (!it.str.trim()) continue;
    const y = it.transform[5];
    const line = lines.find((l) => Math.abs(l.y - y) < 2);
    if (line) line.parts.push(it.str);
    else lines.push({ y, parts: [it.str] });
  }
  const out: string[] = [];
  for (const l of lines.sort((a, b) => b.y - a.y)) {
    const text = l.parts.join(" ").replace(/\s+/g, " ").trim();
    if (BODY_START.test(text) || out.length >= HEADER_LINES) break;
    out.push(text);
  }
  return out.join("\n").slice(0, 1500);
}

export function fingerprintOf(text: string): Uint32Array | null {
  const s = text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
  const hashes = new Set<number>();
  for (let i = 0; i + SHINGLE <= s.length; i++) {
    const h = fnv1a(s, i, i + SHINGLE);
    if (h % SAMPLE === 0) hashes.add(h);
  }
  return hashes.size >= MIN_HASHES
    ? Uint32Array.from([...hashes].sort((a, b) => a - b))
    : null;
}

function fnv1a(s: string, start: number, end: number) {
  let h = 0x811c9dc5;
  for (let i = start; i < end; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/**
 * 2つの本文がどれだけ重なるか。
 * jaccard: 全体の重なり（修正版どうしは高い）
 * containment: 小さいほうがどれだけ大きいほうに含まれるか（大幅に加筆した版も拾う）
 */
export function similarity(a: Uint32Array, b: Uint32Array) {
  let i = 0;
  let j = 0;
  let common = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      common++;
      i++;
      j++;
    } else if (a[i] < b[j]) i++;
    else j++;
  }
  return {
    jaccard: common / (a.length + b.length - common),
    containment: common / Math.min(a.length, b.length),
  };
}

export const encodeFingerprint = (f: Uint32Array) =>
  Buffer.from(f.buffer, f.byteOffset, f.byteLength).toString("base64");

export function decodeFingerprint(s: string) {
  const buf = Buffer.from(s, "base64");
  return new Uint32Array(
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
  );
}
