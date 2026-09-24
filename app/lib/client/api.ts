import type { ScaledPosition } from "react-pdf-highlighter-plus";
import type {
  Author,
  Comment,
  DocumentDetail,
  PaperFields,
  PaperSummary,
  Person,
  Status,
  UploadResult,
} from "../contracts";
export type {
  Author,
  Comment,
  DocumentDetail,
  DocumentInfo,
  PaperFields,
  PaperSummary,
  Person,
  ReviewInfo,
  Status,
  SubmissionFields,
  Version,
} from "../contracts";

/** 書き込みPDFを送ったときの知らせ */
export function annotatedMessage(res: {
  document: { title: string };
  version: { number: number };
  annotated?: { count: number; alreadyImported: boolean };
}) {
  const a = res.annotated;
  if (!a) return undefined;
  const where = `「${res.document.title}」の v${res.version.number}`;
  if (a.alreadyImported)
    return `この書き込みPDFは、すでに${where}に取り込んであります`;
  if (a.count)
    return `書き込み ${a.count} 件を${where}のコメントとして取り込みました`;
  return `本文が${where}と同じなので、書き込みPDFとして保存しました（書き込みは読み取れませんでした）`;
}

/** 鍵が古くなったとき（リンクを作り直したとき）に、鍵の画面へ切り替える合図 */
export const LOCKED_EVENT = "revi:locked";

async function send(url: string, init?: RequestInit) {
  const res = await fetch(url, init);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    if (data.locked) window.dispatchEvent(new Event(LOCKED_EVENT));
    throw new Error(data.error ?? `通信に失敗しました（${res.status}）`);
  }
  return res;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await send(url, init);
  return res.status === 204 ? (undefined as T) : res.json();
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

type Meta = { slack: boolean; authors: string[]; blobUpload: boolean };
let meta: Promise<Meta> | undefined;
const metaOnce = () =>
  (meta ??= request<Meta>("/api/meta").catch(
    (err) => ((meta = undefined), Promise.reject(err)),
  ));

export const api = {
  meta: () => request<Meta>("/api/meta"),
  documents: () => request<PaperSummary[]>("/api/documents"),
  document: (id: string) => request<DocumentDetail>(`/api/documents/${id}`),
  /** 空の題名を送ると、PDF から読んだ題名に戻す */
  renameDocument: (id: string, title: string) =>
    request<unknown>(`/api/documents/${id}`, json("PATCH", { title })),
  updatePaper: (id: string, patch: Partial<PaperFields>) =>
    request<unknown>(`/api/documents/${id}`, json("PATCH", patch)),
  deleteDocument: (id: string) =>
    request<void>(`/api/documents/${id}`, { method: "DELETE" }),
  /** 名前で渡した知らない人は新しく登録する */
  setAuthors: (id: string, authors: ({ id: string } | { name: string })[]) =>
    request<Author[]>(`/api/documents/${id}/authors`, json("PUT", { authors })),
  /** 原稿を画面の並びのまま書き出して、ファイルとして保存させる */
  exportPapers: async (ids: string[], format: "csv" | "xlsx") => {
    const res = await send("/api/export", json("POST", { ids, format }));
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a");
    a.href = url;
    a.download = `原稿_${new Date().toLocaleDateString("sv").replace(/-/g, "")}.${format}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  },
  access: () => request<{ url: string }>("/api/access"),
  rotateAccess: () =>
    request<{ url: string }>("/api/access/rotate", { method: "POST" }),
  /** 著者を入れるときの候補 */
  people: () => request<Person[]>("/api/people"),
  setNameEn: (id: string, name_en: string) =>
    request<unknown>(`/api/people/${id}`, json("PATCH", { name_en })),
  bibUrl: (personId: string) => `/api/people/${personId}/bib`,
  publications: (year?: number) =>
    request<{
      year: number;
      years: number[];
      text: string;
      items: { id: string; section: string; text: string }[];
      undated: string[];
    }>(`/api/publications${year ? `?year=${year}` : ""}`),
  approve: (id: string, author: string) =>
    request<unknown>(`/api/documents/${id}/approval`, json("POST", { author })),
  submit: (
    id: string,
    input: { author: string; receipt: File; reason?: string },
  ) => {
    const form = new FormData();
    form.append("author", input.author);
    form.append("receipt", input.receipt);
    if (input.reason) form.append("reason", input.reason);
    return request<unknown>(`/api/documents/${id}/submission`, {
      method: "POST",
      body: form,
    });
  },
  undoSubmission: (id: string) =>
    request<void>(`/api/documents/${id}/submission`, { method: "DELETE" }),
  receiptUrl: (id: string) => `/api/documents/${id}/receipt`,
  upload: async (
    file: File,
    fields: { author?: string; documentId?: string },
  ) => {
    // Vercel Blob を使うときは、PDF をブラウザから直接 Blob に送ってから登録する（サーバーには 4.5MB までしか送れない）
    if ((await metaOnce()).blobUpload) {
      const { upload } = await import("@vercel/blob/client");
      const blob = await upload(
        `uploads/${file.name.replace(/[^\w.\-]+/g, "_") || "file.pdf"}`,
        file,
        {
          access: "private",
          handleUploadUrl: "/api/uploads",
          contentType: "application/pdf",
          multipart: file.size > 5 * 1024 * 1024,
        },
      );
      return request<UploadResult>(
        "/api/documents",
        json("POST", {
          uploaded: blob.pathname,
          filename: file.name,
          ...fields,
        }),
      );
    }
    const form = new FormData();
    form.append("file", file);
    if (fields.author) form.append("author", fields.author);
    if (fields.documentId) form.append("documentId", fields.documentId);
    return request<UploadResult>("/api/documents", {
      method: "POST",
      body: form,
    });
  },
  pdfUrl: (versionId: string) => `/api/versions/${versionId}/pdf`,
  copyUrl: (copyId: string) => `/api/copies/${copyId}/pdf`,
  deleteVersion: (versionId: string) =>
    request<{ documentDeleted: boolean }>(`/api/versions/${versionId}`, {
      method: "DELETE",
    }),
  /** documentId を省くと、新しい原稿として切り離す */
  moveVersion: (versionId: string, documentId?: string) =>
    request<{ documentId: string; number: number }>(
      `/api/versions/${versionId}/move`,
      json("POST", { documentId }),
    ),
  dismissSuggestion: (versionId: string) =>
    request<void>(`/api/versions/${versionId}/suggestion`, {
      method: "DELETE",
    }),
  comments: (versionId: string) =>
    request<Comment[]>(`/api/versions/${versionId}/comments`),
  createComment: (
    versionId: string,
    input: {
      author: string;
      body: string;
      parentId?: string;
      kind?: "text" | "area" | "general";
      quote?: string;
      position?: ScaledPosition;
    },
  ) =>
    request<Comment>(
      `/api/versions/${versionId}/comments`,
      json("POST", input),
    ),
  updateComment: (id: string, patch: { body?: string; status?: Status }) =>
    request<Comment>(`/api/comments/${id}`, json("PATCH", patch)),
  deleteComment: (id: string) =>
    request<void>(`/api/comments/${id}`, { method: "DELETE" }),
};

export const STATUS_LABEL: Record<Status, string> = {
  open: "未対応",
  resolved: "対応済み",
  wontfix: "見送り",
};

export function formatDate(iso: string) {
  const d = new Date(iso);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleString("ja-JP", {
    year: sameYear ? undefined : "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
