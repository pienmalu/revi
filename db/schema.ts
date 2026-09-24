// データベースの表。monorepo の packages/database と同じ形にしておき、あとで移せるようにする。
// 列の名前は、画面や API の JSON と同じ snake_case のままにしている（そのまま返せるように）。
// 日時は ISO 形式の文字列（"2026-09-24T01:23:45.678Z"）、日付は "YYYY-MM-DD" で持つ。

import type { Comment } from "../app/lib/contracts";

import {
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  unique,
} from "drizzle-orm/pg-core";

/** 原稿 = 投稿1件。書き始めから、共著者の確認、提出、業績まで */
export const documents = pgTable(
  "documents",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    normalized_title: text("normalized_title").notNull(),
    slack_channel: text("slack_channel"),
    slack_thread_ts: text("slack_thread_ts"),
    created_by: text("created_by"),
    created_at: text("created_at").notNull(),
    /** 題名を人が直した（PDF の題名で上書きしない） */
    title_manual: integer("title_manual").notNull().default(0),
    /** 著者を人が確かめた（PDF から読み直さない） */
    authors_confirmed: integer("authors_confirmed").notNull().default(0),

    // 提出まで
    venue: text("venue"),
    deadline: text("deadline"),

    // 提出
    submitted_at: text("submitted_at"),
    submitted_by: text("submitted_by"),
    submitted_version_id: text("submitted_version_id"),
    /** 受領メール（ファイルかスクリーンショット）の置き場所 */
    receipt_key: text("receipt_key"),
    receipt_name: text("receipt_name"),
    /** 全員の確認OKが無いまま出したときの理由 */
    skip_reason: text("skip_reason"),

    // 業績（提出のあとに入れる）
    /** 不採録だった（業績に入れない） */
    rejected: integer("rejected").notNull().default(0),
    published_month: text("published_month"), // YYYY-MM
    volume: text("volume"),
    number: text("number"),
    pages: text("pages"),
    /** 講演番号・報告番号（例 G-37、LOIS2025-46） */
    paper_no: text("paper_no"),
    note: text("note"),
  },
  (t) => [
    index("documents_thread").on(t.slack_channel, t.slack_thread_ts),
    index("documents_title").on(t.slack_channel, t.normalized_title),
  ],
);

export const versions = pgTable(
  "versions",
  {
    id: text("id").primaryKey(),
    document_id: text("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    filename: text("filename").notNull(),
    sha256: text("sha256").notNull(),
    uploaded_by: text("uploaded_by"),
    slack_file_id: text("slack_file_id"),
    created_at: text("created_at").notNull(),
    /** PDF の1ページ目から読んだ題名 */
    title: text("title"),
    layout: text("layout"), // 'portrait'（縦長の論文など）| 'landscape'（スライド）
    /** 本文の指紋（analyze.ts） */
    fingerprint: text("fingerprint"),
    /** PDF が投稿された Slack のメッセージ */
    slack_ts: text("slack_ts"),
    /** 「この原稿の版かもしれない」と思われる原稿 */
    suggested_document_id: text("suggested_document_id"),
    /** 1ページ目の頭（著者を探すのに使う） */
    header: text("header"),
  },
  (t) => [
    unique("versions_number").on(t.document_id, t.number),
    unique("versions_document_sha").on(t.document_id, t.sha256),
    index("versions_slack_file").on(t.slack_file_id),
  ],
);

export const comments = pgTable(
  "comments",
  {
    id: text("id").primaryKey(),
    version_id: text("version_id")
      .notNull()
      .references(() => versions.id, { onDelete: "cascade" }),
    parent_id: text("parent_id"),
    author: text("author").notNull(),
    body: text("body").notNull(),
    /** 'text' | 'area' | 'general'（全体へのコメント）。返信は null */
    kind: text("kind").$type<Comment["kind"]>(),
    quote: text("quote"),
    /** react-pdf-highlighter の ScaledPosition */
    position: jsonb("position").$type<Comment["position"]>(),
    status: text("status").$type<Comment["status"]>().notNull().default("open"), // 'open' | 'resolved' | 'wontfix'
    created_at: text("created_at").notNull(),
    updated_at: text("updated_at").notNull(),
    /** 書き込みPDFから取り込んだコメント */
    copy_id: text("copy_id"),
    /** 取り込んだ書き込みの目印（同じ書き込みを二重に取り込まない） */
    import_key: text("import_key"),
  },
  (t) => [index("comments_version").on(t.version_id)],
);

/** 共著者が手元で書き込みを入れて送り返したPDF（書き込みPDF）。版は作らず、書き込みをその版のコメントにする */
export const copies = pgTable(
  "copies",
  {
    id: text("id").primaryKey(),
    version_id: text("version_id")
      .notNull()
      .references(() => versions.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    sha256: text("sha256").notNull(),
    uploaded_by: text("uploaded_by"),
    slack_file_id: text("slack_file_id"),
    created_at: text("created_at").notNull(),
  },
  (t) => [index("copies_version").on(t.version_id)],
);

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

/** 研究室の人。Slack の名前が同じなら、Slack のアカウントとつながる */
export const people = pgTable("people", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  /** ローマ字の名前（HP の英語の業績と .bib に使う） */
  name_en: text("name_en"),
  slack_user_id: text("slack_user_id").unique(),
  created_at: text("created_at").notNull(),
});

/** 同じ人の別の書き方（漢字・ローマ字・旧姓など）。key は names.ts の nameKey */
export const person_names = pgTable(
  "person_names",
  {
    person_id: text("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    key: text("key").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.person_id, t.key] }),
    index("person_names_key").on(t.key),
  ],
);

export const document_authors = pgTable(
  "document_authors",
  {
    document_id: text("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    person_id: text("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.document_id, t.person_id] }),
    index("document_authors_person").on(t.person_id),
  ],
);

/** 共著者の確認OK。版ごとに1人1つ */
export const approvals = pgTable(
  "approvals",
  {
    version_id: text("version_id")
      .notNull()
      .references(() => versions.id, { onDelete: "cascade" }),
    person_id: text("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    created_at: text("created_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.version_id, t.person_id] })],
);

/** 送ったリマインド。同じものを二度送らない */
export const reminders_sent = pgTable(
  "reminders_sent",
  {
    document_id: text("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(), // 'd7' | 'd3' | 'd1' | 'overdue'
    deadline: text("deadline").notNull(),
    sent_at: text("sent_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.document_id, t.kind, t.deadline] })],
);

export type DocumentRow = typeof documents.$inferSelect;
export type VersionRow = typeof versions.$inferSelect;
export type CommentRow = typeof comments.$inferSelect;
export type CopyRow = typeof copies.$inferSelect;
export type PersonRow = typeof people.$inferSelect;
