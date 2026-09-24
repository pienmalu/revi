import { createHash } from "node:crypto";
import { IngestError } from "./errors";
import { createPdfMatcher } from "./pdf-match";
import * as documentActions from "./document-actions";
import {
  analyzePdf,
  encodeFingerprint,
  PdfReadError,
  type PdfAnnotation,
} from "./analyze";
import * as db from "./repo";
import { copyKey, deleteFiles, getFile, pdfKey, putFile } from "./storage";
import { findNames } from "./names";
import { displayTitle, normalizeTitle } from "./title";

export type IngestResult = {
  document: db.DocumentRow;
  version: db.VersionRow;
  isNewDocument: boolean;
  /** 既存の版とファイルがまったく同じで、新しい版を作らなかった */
  duplicate: boolean;
  /**
   * 本文が前の版と同じ（共著者が手元で書き込みを入れて返したPDF）ため、版を作らなかった。
   * 書き込みはその版（version）のコメントとして取り込んだ。count が 0 なら、書き込みを読み取れなかった
   */
  annotated?: { count: number; alreadyImported: boolean; latestNumber: number };
  /** 新しい原稿として登録したが、この原稿の版かもしれない */
  suggestion?: db.DocumentRow;
};

/** 利用者に見せてよい理由付きの失敗 */
export { IngestError } from "./errors";

// 本文の重なりの目安（analyze.ts の similarity）
const SAME_PAPER = 0.4; // jaccard がこれ以上なら、同じ原稿の修正版とみなす（4割書き換えで約 0.45、別の文章は 0.1 未満）
const MAYBE_SAME = 0.3; // containment がこれ以上なら、同じ原稿かもしれない
const SAME_TEXT = 0.98; // 本文が同じ（書き込みだけが違う）

/**
 * PDF を保存し、どの原稿の何版目かを決める。
 * ファイル名や題名はよく変わるので、「誰が送ったか」と「本文がどれだけ似ているか」で決める。
 *   1. 比べる相手は、同じスレッドの原稿と、送った人が前に関わった原稿（縦長の論文と横長のスライドは分ける）
 *   2. 本文がとても似ていれば次の版。少し似ていれば新しい原稿にして「この原稿の版ですか？」と聞く
 *   3. 本文が読めないPDF（画像だけなど）は、スレッドとファイル名で決める
 */
export async function ingestPdf(input: {
  buffer: Buffer;
  filename: string;
  uploadedBy?: string;
  /** 送った人（人の一覧の ID）。PDF から著者が見つからないときの仮の著者にする */
  uploaderId?: string;
  documentId?: string;
  slack?: {
    channel: string;
    threadTs?: string;
    messageTs: string;
    fileId: string;
  };
  /** 本文が同じでも新しい版として登録する */
  force?: boolean;
}): Promise<IngestResult> {
  if (input.buffer.subarray(0, 1024).indexOf("%PDF-") === -1) {
    throw new IngestError("PDFではないファイルです");
  }
  const analysis = await analyzePdf(input.buffer).catch((err) => {
    throw err instanceof PdfReadError ? new IngestError(err.message) : err;
  });
  const sha256 = createHash("sha256").update(input.buffer).digest("hex");
  const normalizedTitle = normalizeTitle(input.filename);

  let document: db.DocumentRow | undefined;
  let suggestion: db.DocumentRow | undefined;
  const bestMatch = createPdfMatcher(analysis, {
    versions: db.versionsForDocuments,
    analysis: ensureAnalysis,
  });
  let best: Awaited<ReturnType<typeof bestMatch>>;
  if (input.documentId) {
    document = await db.getDocument(input.documentId);
    if (!document) throw new IngestError("追加先の原稿が見つかりません");
    // 書き込みPDFかどうかを見分けるため、この原稿の版とだけ比べる
    best = await bestMatch([{ ...document, in_thread: true }]);
  } else {
    const candidates = await db.candidateDocuments({
      channel: input.slack?.channel,
      threadTs: input.slack?.threadTs,
      uploader: input.uploadedBy,
    });
    best = await bestMatch(candidates);
    // 本文がまったく同じなら（共著者が書き込みを入れて返したPDF）、送った人に関係なく同じ原稿
    if (!best || best.jaccard < SAME_TEXT) {
      const same = await bestMatch(await db.documentsIn(input.slack?.channel));
      if (same && same.jaccard >= SAME_TEXT) best = same;
    }
    if (best) {
      if (
        best.jaccard >= SAME_PAPER ||
        (best.document.in_thread && best.containment >= MAYBE_SAME)
      ) {
        document = best.document;
      } else if (best.containment >= MAYBE_SAME) {
        suggestion = best.document;
      }
    } else if (!analysis.fingerprint) {
      // 本文で比べられないときは、スレッドとファイル名で決める
      document =
        candidates.find(
          (d) => d.in_thread && d.normalized_title === normalizedTitle,
        ) ??
        candidates.find(
          (d) => !d.in_thread && d.normalized_title === normalizedTitle,
        );
    }
  }

  if (document) {
    const latest = await db.latestVersion(document.id);
    const same = await db.findVersionBySha(document.id, sha256);
    if (same)
      return { document, version: same, isNewDocument: false, duplicate: true };
    // 本文がどれかの版と同じなら、書き込みを入れて返したPDF。版は作らず、書き込みをその版のコメントにする
    // （書き手本人が本文を変えずに送り直したときは、書き込みが無ければ新しい版にする）
    const sameAs =
      !input.force &&
      best?.document.id === document.id &&
      best.jaccard >= SAME_TEXT
        ? best.version
        : undefined;
    if (sameAs) {
      const byAuthor = Boolean(
        input.uploadedBy &&
        (await db.isUploader(document.id, input.uploadedBy)),
      );
      const fresh = await freshAnnotations(sameAs, analysis.annotations);
      if (fresh.length || !byAuthor) {
        const annotated = await importAnnotations(sameAs, fresh, input, sha256);
        return {
          document,
          version: sameAs,
          isNewDocument: false,
          duplicate: false,
          annotated: {
            ...annotated,
            latestNumber: latest?.number ?? sameAs.number,
          },
        };
      }
    }
  }

  const title = analysis.title || displayTitle(input.filename);
  const isNewDocument = !document;
  // 保存できなかった新規資料をDBに残さない。
  const versionId = db.newId();
  await putFile(pdfKey(versionId), input.buffer);
  if (!document) {
    document = await db.createDocument({
      // 同一PDFの初回登録が重なっても、同じ資料に集約する。
      id: `pdf-${createHash("sha256")
        .update(JSON.stringify([input.slack?.channel ?? null, sha256]))
        .digest("hex")}`,
      title,
      normalizedTitle,
      slackChannel: input.slack?.channel,
      slackThreadTs: input.slack
        ? (input.slack.threadTs ?? input.slack.messageTs)
        : undefined,
      createdBy: input.uploadedBy,
    });
  }

  const added = await db.addVersion({
    id: versionId,
    documentId: document.id,
    filename: input.filename,
    sha256,
    uploadedBy: input.uploadedBy,
    slackFileId: input.slack?.fileId,
    slackTs: input.slack?.messageTs,
    title,
    layout: analysis.layout,
    fingerprint: analysis.fingerprint
      ? encodeFingerprint(analysis.fingerprint)
      : undefined,
    suggestedDocumentId: suggestion?.id,
    header: analysis.header,
  });
  const { version } = added;
  if (added.duplicate) {
    await deleteFiles([pdfKey(versionId)]);
    return { document, version, isNewDocument: false, duplicate: true };
  }
  await documentActions.refreshDocumentTitle(document.id);
  await detectAuthors(document.id, input.uploaderId);
  return {
    document: (await db.getDocument(document.id))!,
    version,
    isNewDocument,
    duplicate: false,
    suggestion,
  };
}

/** 書き込みPDFの書き込みのうち、元の版にもともと無く、まだ取り込んでいないもの */
async function freshAnnotations(
  version: db.VersionRow,
  annotations: PdfAnnotation[],
) {
  if (!annotations.length) return [];
  let own = new Set<string>();
  try {
    const original = await getFile(pdfKey(version.id));
    if (original)
      own = new Set((await analyzePdf(original)).annotations.map((a) => a.key));
  } catch {
    // 元の版が読めなければ、すべて新しい書き込みとして扱う
  }
  const imported = await db.importedKeys(version.id);
  return annotations.filter((a) => !own.has(a.key) && !imported.has(a.key));
}

// 本文の無い書き込み（マーカーだけ、手書きだけなど）に付ける説明
const NO_TEXT: Record<string, string> = {
  Highlight: "（マーカーのみ）",
  Underline: "（下線のみ）",
  Squiggly: "（波線のみ）",
  StrikeOut: "（取り消し線：削除の提案）",
  Caret: "（挿入の印）",
  Ink: "（手書きの書き込み。書き込みPDFで見られます）",
  Stamp: "（スタンプ）",
};

/**
 * 書き込みPDFを保存し、書き込みをその版のコメントにする。
 * 名前は、PDF に書いた人の名前があればそれ（知っている人なら一覧の書き方にそろえる）、無ければ送った人。
 * 書き込みが読み取れないとき（手書きを画像として保存したPDFなど）は、PDF へのリンクを全体へのコメントにする。
 */
async function importAnnotations(
  version: db.VersionRow,
  annotations: PdfAnnotation[],
  input: {
    buffer: Buffer;
    filename: string;
    uploadedBy?: string;
    slack?: { fileId: string };
  },
  sha256: string,
) {
  const existing = await db.findCopy({
    sha256,
    slackFileId: input.slack?.fileId,
  });
  if (existing) return { count: 0, alreadyImported: true };
  const copy = await db.createCopy({
    versionId: version.id,
    filename: input.filename,
    sha256,
    uploadedBy: input.uploadedBy,
    slackFileId: input.slack?.fileId,
  });
  await putFile(copyKey(copy.id), input.buffer);
  const sender = input.uploadedBy || "不明";
  const nameOf = async (a: PdfAnnotation) =>
    a.author
      ? ((await db.findPersonByName(a.author))?.name ?? a.author)
      : sender;

  if (!annotations.length) {
    await db.createComment({
      versionId: version.id,
      author: sender,
      kind: "general",
      body: `書き込みPDF「${input.filename}」を送りました（書き込みは読み取れませんでした）。`,
      copyId: copy.id,
    });
    return { count: 0, alreadyImported: false };
  }

  // 親の書き込みを先に作り、返信（PDF の中で「返信」になっている書き込み）をその下に付ける
  const byRef = new Map(annotations.map((a) => [a.ref, a]));
  const created = new Map<string, string>();
  const roots = annotations.filter(
    (a) => !a.inReplyTo || !byRef.has(a.inReplyTo),
  );
  for (const a of roots) {
    const c = await db.createComment({
      versionId: version.id,
      author: await nameOf(a),
      kind: a.kind,
      quote: a.quote || undefined,
      position: a.position,
      body: a.contents || NO_TEXT[a.subtype] || "（書き込み）",
      copyId: copy.id,
      importKey: a.key,
    });
    created.set(a.ref, c.id);
  }
  for (const a of annotations.filter((x) => !roots.includes(x))) {
    const parentId = created.get(a.inReplyTo!);
    if (!parentId || !a.contents) continue;
    await db.createComment({
      versionId: version.id,
      parentId,
      author: await nameOf(a),
      body: a.contents,
      copyId: copy.id,
      importKey: a.key,
    });
  }
  return { count: roots.length, alreadyImported: false };
}

/** 本文の指紋が無い版（この仕組みを入れる前に登録した版）は、保存してあるPDFから作る */
async function ensureAnalysis(v: db.VersionRow) {
  if (v.layout && v.header !== null)
    return { layout: v.layout, fingerprint: v.fingerprint };
  let a: {
    title: string | null;
    layout: "portrait" | "landscape";
    fingerprint: string | null;
    header: string;
  };
  try {
    const file = await getFile(pdfKey(v.id));
    if (!file) throw new Error("PDF が見つかりません");
    const result = await analyzePdf(file);
    a = {
      title: result.title ?? null,
      layout: result.layout,
      fingerprint: result.fingerprint
        ? encodeFingerprint(result.fingerprint)
        : null,
      header: result.header,
    };
  } catch {
    a = { title: null, layout: "portrait", fingerprint: null, header: "" };
  }
  await db.setVersionAnalysis(v.id, a);
  return a;
}

/** 起動時に、古い版の題名と指紋をまとめて作る */
export async function backfillAnalysis() {
  const versions = await db.versionsMissingAnalysis();
  for (const v of versions) {
    await ensureAnalysis(v);
    await documentActions.refreshDocumentTitle(v.document_id);
    await detectAuthors(v.document_id);
  }
  if (versions.length)
    console.log(`[ingest] ${versions.length} 件の版の本文を読み取りました`);
}

/**
 * いちばん新しい版の1ページ目から、知っている人の名前を探して著者にする。
 * 人が著者を確かめた原稿は変えない。見つからなければ、送った人を仮の著者にする。
 */
export async function detectAuthors(documentId: string, uploaderId?: string) {
  const document = await db.getDocument(documentId);
  if (!document || document.authors_confirmed) return;
  const header = (await db.latestVersion(documentId))?.header ?? "";
  const found = findNames(header, await db.allPersonNames());
  if (found.length) await db.setAuthors(documentId, found, false);
  else if (uploaderId && !(await db.listAuthors(documentId)).length)
    await db.setAuthors(documentId, [uploaderId], false);
}

/** 人を足したり名前を覚えさせたりしたあと、著者をまだ確かめていない原稿を読み直す */
export async function redetectAuthors() {
  for (const d of await db.listDocuments()) await detectAuthors(d.id);
}
