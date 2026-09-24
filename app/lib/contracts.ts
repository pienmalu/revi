import type { ScaledPosition } from "react-pdf-highlighter-plus";
import type { Stage, ReviewState } from "./stage";

export type Status = "open" | "resolved" | "wontfix";

export type Author = { id: string; name: string };

/** 画面から直せる、提出先と業績の情報 */
export type PaperFields = {
  venue: string | null;
  /** YYYY-MM-DD */
  deadline: string | null;
  /** 不採録だった（業績に入れない）。1 か 0 */
  rejected: number;
  /** 発表の年月（YYYY-MM） */
  published_month: string | null;
  volume: string | null;
  number: string | null;
  pages: string | null;
  paper_no: string | null;
  note: string | null;
};

/** 提出の記録 */
export type SubmissionFields = {
  submitted_at: string | null;
  submitted_by: string | null;
  submitted_version_id: string | null;
  receipt_name: string | null;
  skip_reason: string | null;
};

/** 一覧の1行 */
export type PaperSummary = PaperFields &
  SubmissionFields & {
    id: string;
    title: string;
    created_by: string | null;
    created_at: string;
    updated_at: string;
    /** 版をすべて消した原稿は null */
    latest_version: number | null;
    comment_count: number;
    open_count: number;
    authors: Author[];
    stage: Stage;
    /** まだ確認OKが無い人数と、確認OKを出す人数 */
    waiting: number;
    reviewers: number;
    /** 締切を過ぎたのに提出の報告がない */
    overdue: boolean;
  };

export type DocumentInfo = PaperFields &
  SubmissionFields & {
    id: string;
    title: string;
    slack_channel: string | null;
    /** Slack のスレッドを開くリンク */
    slack_url: string | null;
    created_by: string | null;
    created_at: string;
    title_manual: number;
    authors_confirmed: number;
  };

/** 共著者の確認の様子（最新版） */
export type ReviewInfo = ReviewState & {
  /** 確認OKを出す人（筆頭著者を除く著者の順） */
  people: { id: string; name: string; ok: boolean }[];
};

export type DocumentDetail = {
  document: DocumentInfo;
  versions: Version[];
  authors: Author[];
  review: ReviewInfo;
};

export type Person = Author & {
  name_en: string | null;
  /** ローマ字が入っていないとき、PDF などで覚えたローマ字の書き方 */
  name_en_guess: string | null;
  slack_user_id: string | null;
  papers: number;
  keys: string[];
};

export type Version = {
  id: string;
  number: number;
  filename: string;
  uploaded_by: string | null;
  created_at: string;
  title: string | null;
  /** 1ページ目の頭（題名から概要の前まで） */
  header: string | null;
  /** 本文が似ていて「この原稿の版かもしれない」と思われる原稿 */
  suggested_document_id: string | null;
  suggested_title: string | null;
  comment_count: number;
  open_count: number;
};

export type Comment = {
  id: string;
  version_id: string;
  parent_id: string | null;
  author: string;
  body: string;
  /** general は全体へのコメント（場所が無い） */
  kind: "text" | "area" | "general" | null;
  quote: string | null;
  position: ScaledPosition | null;
  status: Status;
  created_at: string;
  updated_at: string;
  /** 共著者が送った書き込みPDFから取り込んだコメント */
  copy_id: string | null;
  replies: Comment[];
};

export type DocumentRecord = Omit<DocumentInfo, "slack_url"> & {
  normalized_title: string;
  slack_thread_ts: string | null;
  receipt_key: string | null;
};

/** 登録直後の版。表示用の集計・候補の題名は詳細APIで取得する。 */
export type UploadedVersion = Omit<
  Version,
  "comment_count" | "open_count" | "suggested_title"
> & {
  document_id: string;
  sha256: string;
  slack_file_id: string | null;
  slack_ts: string | null;
  layout: string | null;
};
export type UploadResult = {
  document: DocumentRecord;
  version: UploadedVersion;
  isNewDocument: boolean;
  duplicate: boolean;
  annotated?: { count: number; alreadyImported: boolean; latestNumber: number };
  suggestion?: DocumentRecord;
};
