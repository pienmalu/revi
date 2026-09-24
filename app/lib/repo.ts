// 資料、版、コメント、利用者のDB操作。

import { randomBytes } from "node:crypto";
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  sql,
  type SQL,
} from "drizzle-orm";
import {
  approvals,
  comments,
  copies,
  document_authors,
  documents,
  getDb,
  people,
  person_names,
  settings,
  reminders_sent,
  versions,
  type CommentRow,
  type CopyRow,
  type DocumentRow,
  type PersonRow,
  type VersionRow,
} from "@/db";
import { nameKey, nameKeys } from "./names";
import type {
  Author,
  Status,
  Comment as ApiComment,
  PaperFields,
} from "./contracts";

export type { Author, Status, PaperFields } from "./contracts";

export type { CommentRow, CopyRow, DocumentRow, PersonRow, VersionRow };

const now = () => new Date().toISOString();
export const newId = () => randomBytes(6).toString("base64url");

/** 生の SQL を投げて、行だけを返す（neon-http と PGlite で返り値の形がそろうように） */
async function rows<T>(query: SQL): Promise<T[]> {
  const db = await getDb();
  const result = (await db.execute(query)) as unknown as { rows: T[] };
  return result.rows;
}

/** 画面から直せる、提出の情報 */
export const PAPER_FIELDS = [
  "venue",
  "deadline",
  "rejected",
  "published_month",
  "volume",
  "number",
  "pages",
  "paper_no",
  "note",
] as const satisfies readonly (keyof PaperFields)[];

export type Comment = ApiComment & { import_key: string | null };

// ---------- 書き込みPDF ----------

export async function createCopy(input: {
  versionId: string;
  filename: string;
  sha256: string;
  uploadedBy?: string;
  slackFileId?: string;
}) {
  const row: CopyRow = {
    id: newId(),
    version_id: input.versionId,
    filename: input.filename,
    sha256: input.sha256,
    uploaded_by: input.uploadedBy ?? null,
    slack_file_id: input.slackFileId ?? null,
    created_at: now(),
  };
  const db = await getDb();
  await db.insert(copies).values(row);
  return row;
}

export async function getCopy(id: string) {
  const db = await getDb();
  const [row] = await db.select().from(copies).where(eq(copies.id, id));
  return row;
}

export async function findCopy(where: {
  sha256?: string;
  slackFileId?: string;
}) {
  const db = await getDb();
  if (where.slackFileId) {
    const [row] = await db
      .select()
      .from(copies)
      .where(eq(copies.slack_file_id, where.slackFileId));
    if (row) return row;
  }
  if (where.sha256) {
    const [row] = await db
      .select()
      .from(copies)
      .where(eq(copies.sha256, where.sha256));
    return row;
  }
  return undefined;
}

/** 書き込みPDFと、そこから取り込んだコメントを消す */
export async function deleteCopyRow(id: string) {
  const db = await getDb();
  await db.delete(comments).where(eq(comments.copy_id, id));
  await db.delete(copies).where(eq(copies.id, id));
}

/** この版にすでに取り込んだ書き込みの目印 */
export async function importedKeys(versionId: string) {
  const db = await getDb();
  const list = await db
    .select({ key: comments.import_key })
    .from(comments)
    .where(
      and(eq(comments.version_id, versionId), isNotNull(comments.import_key)),
    );
  return new Set(list.map((r) => r.key!));
}

// ---------- 原稿 ----------

export async function createDocument(input: {
  id?: string;
  title: string;
  normalizedTitle: string;
  slackChannel?: string;
  slackThreadTs?: string;
  createdBy?: string;
  titleManual?: boolean;
}) {
  const db = await getDb();
  const id = input.id ?? newId();
  const [row] = await db
    .insert(documents)
    .values({
      id,
      title: input.title,
      normalized_title: input.normalizedTitle,
      slack_channel: input.slackChannel ?? null,
      slack_thread_ts: input.slackThreadTs ?? null,
      created_by: input.createdBy ?? null,
      created_at: now(),
      title_manual: input.titleManual ? 1 : 0,
    })
    .onConflictDoNothing({ target: documents.id })
    .returning();
  return row ?? (await getDocument(id))!;
}

export async function getDocument(id: string) {
  const db = await getDb();
  const [row] = await db.select().from(documents).where(eq(documents.id, id));
  return row;
}

/** 原稿の列を直接書き換える（提出や採否の記録など） */
export async function updateDocument(
  id: string,
  patch: Partial<Omit<DocumentRow, "id">>,
) {
  if (!Object.keys(patch).length) return getDocument(id);
  const db = await getDb();
  const [row] = await db
    .update(documents)
    .set(patch)
    .where(eq(documents.id, id))
    .returning();
  return row;
}

/** 未提出のときだけ記録する。同時報告のうち一つだけが成功する。 */
export async function recordSubmission(
  id: string,
  patch: Partial<DocumentRow>,
) {
  const database = await getDb();
  const [row] = await database
    .update(documents)
    .set(patch)
    .where(and(eq(documents.id, id), isNull(documents.submitted_at)))
    .returning();
  return row;
}

/** 提出先や業績の欄を直す。送られてきた項目だけを変える */
export async function updatePaper(id: string, patch: Partial<PaperFields>) {
  const set: Partial<PaperFields> = {};
  for (const f of PAPER_FIELDS)
    if (patch[f] !== undefined) Object.assign(set, { [f]: patch[f] });
  return updateDocument(id, set);
}

/** 版と書き込みPDFのID。ファイルの保存方式は呼び出し側で扱う。 */
export async function fileIdsOf(
  scope: { documentId: string } | { versionId: string },
) {
  const db = await getDb();
  const where =
    "documentId" in scope
      ? eq(versions.document_id, scope.documentId)
      : eq(versions.id, scope.versionId);
  const vs = await db.select({ id: versions.id }).from(versions).where(where);
  const versionIds = vs.map((v) => v.id);
  const cs = versionIds.length
    ? await db
        .select({ id: copies.id })
        .from(copies)
        .where(inArray(copies.version_id, versionIds))
    : [];
  return { versionIds, copyIds: cs.map((c) => c.id) };
}

export async function setAutomaticTitle(documentId: string, title: string) {
  const db = await getDb();
  await db
    .update(documents)
    .set({ title })
    .where(and(eq(documents.id, documentId), eq(documents.title_manual, 0)));
}

export async function deleteDocumentRow(documentId: string) {
  const db = await getDb();
  const deleted = await db
    .delete(documents)
    .where(eq(documents.id, documentId))
    .returning({ id: documents.id });
  return deleted.length > 0;
}

export async function deleteVersionRow(versionId: string) {
  const db = await getDb();
  await db.delete(versions).where(eq(versions.id, versionId));
}

// ---------- 版 ----------

async function nextNumber(documentId: string) {
  const [r] = await rows<{ next: number }>(
    sql`SELECT COALESCE(MAX(number), 0) + 1 AS next FROM versions WHERE document_id = ${documentId}`,
  );
  return Number(r.next);
}

export async function addVersion(input: {
  id?: string;
  documentId: string;
  filename: string;
  sha256: string;
  uploadedBy?: string;
  slackFileId?: string;
  slackTs?: string;
  title?: string;
  layout?: "portrait" | "landscape";
  fingerprint?: string;
  suggestedDocumentId?: string;
  header?: string;
}) {
  const db = await getDb();
  // 同じ版番号で競合したら、最新の番号を取り直す。
  for (let attempt = 0; attempt < 20; attempt++) {
    const existing = await findVersionBySha(input.documentId, input.sha256);
    if (existing) return { version: existing, duplicate: true };
    const [row] = await db
      .insert(versions)
      .values({
        id: input.id ?? newId(),
        document_id: input.documentId,
        number: await nextNumber(input.documentId),
        filename: input.filename,
        sha256: input.sha256,
        uploaded_by: input.uploadedBy ?? null,
        slack_file_id: input.slackFileId ?? null,
        created_at: now(),
        title: input.title ?? null,
        layout: input.layout ?? null,
        fingerprint: input.fingerprint ?? null,
        slack_ts: input.slackTs ?? null,
        suggested_document_id: input.suggestedDocumentId ?? null,
        header: input.header ?? null,
      })
      .onConflictDoNothing()
      .returning();
    if (row) return { version: row, duplicate: false };
  }
  throw new Error("版の登録が混み合っています。もう一度送ってください");
}

export async function setVersionAnalysis(
  id: string,
  a: {
    title: string | null;
    layout: string;
    fingerprint: string | null;
    header: string;
  },
) {
  const db = await getDb();
  await db.update(versions).set(a).where(eq(versions.id, id));
}

export async function setSuggestion(
  versionId: string,
  documentId: string | null,
) {
  const db = await getDb();
  await db
    .update(versions)
    .set({ suggested_document_id: documentId })
    .where(eq(versions.id, versionId));
}

export async function getVersion(id: string) {
  const db = await getDb();
  const [row] = await db.select().from(versions).where(eq(versions.id, id));
  return row;
}

export async function latestVersion(documentId: string) {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(versions)
    .where(eq(versions.document_id, documentId))
    .orderBy(desc(versions.number))
    .limit(1);
  return row;
}

/** 候補の全版を一括取得する。原稿内は新しい順（古い版への書き込みも対象）。 */
export async function versionsForDocuments(documentIds: string[]) {
  if (!documentIds.length) return [];
  const db = await getDb();
  return db
    .select()
    .from(versions)
    .where(inArray(versions.document_id, documentIds))
    .orderBy(desc(versions.number));
}

export async function findVersionBySha(documentId: string, sha256: string) {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(versions)
    .where(
      and(eq(versions.document_id, documentId), eq(versions.sha256, sha256)),
    );
  return row;
}

export async function findVersionBySlackFile(slackFileId: string) {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(versions)
    .where(eq(versions.slack_file_id, slackFileId));
  return row;
}

/** その人が、この原稿を作ったか版を送ったことがあるか */
export async function isUploader(documentId: string, name: string) {
  const found = await rows(
    sql`SELECT 1 FROM documents d WHERE d.id = ${documentId} AND (d.created_by = ${name} OR EXISTS
      (SELECT 1 FROM versions v WHERE v.document_id = d.id AND v.uploaded_by = ${name}))`,
  );
  return found.length > 0;
}

export type VersionInfo = {
  id: string;
  document_id: string;
  number: number;
  filename: string;
  uploaded_by: string | null;
  created_at: string;
  title: string | null;
  layout: string | null;
  suggested_document_id: string | null;
  suggested_title: string | null;
  header: string | null;
  comment_count: number;
  open_count: number;
};

export async function listVersions(documentId: string) {
  const list = await rows<VersionInfo>(
    sql`SELECT v.id, v.document_id, v.number, v.filename, v.uploaded_by, v.created_at, v.title, v.layout,
      v.suggested_document_id, v.header,
      (SELECT s.title FROM documents s WHERE s.id = v.suggested_document_id) AS suggested_title,
      (SELECT COUNT(*) FROM comments c WHERE c.version_id = v.id AND c.parent_id IS NULL) AS comment_count,
      (SELECT COUNT(*) FROM comments c WHERE c.version_id = v.id AND c.parent_id IS NULL AND c.status = 'open') AS open_count
     FROM versions v WHERE v.document_id = ${documentId} ORDER BY v.number`,
  );
  return list.map((v) => ({
    ...v,
    comment_count: Number(v.comment_count),
    open_count: Number(v.open_count),
  }));
}

export async function versionsMissingAnalysis() {
  return rows<VersionRow>(
    sql`SELECT * FROM versions WHERE layout IS NULL OR header IS NULL`,
  );
}

/** 移動先の次の番号で版の所属を更新する。 */
export async function moveVersionRow(
  versionId: string,
  targetDocumentId: string,
) {
  const db = await getDb();
  await db
    .update(versions)
    .set({
      document_id: targetDocumentId,
      number: await nextNumber(targetDocumentId),
      suggested_document_id: null,
    })
    .where(eq(versions.id, versionId));
}

// ---------- 本文を比べる相手 ----------

export type Candidate = DocumentRow & { in_thread: boolean };

/** 本文を比べる相手の候補。スレッドの原稿と、その人が前に関わった原稿 */
export async function candidateDocuments(input: {
  channel?: string;
  threadTs?: string;
  uploader?: string;
}): Promise<Candidate[]> {
  const channel = input.channel ?? null;
  const thread = input.threadTs ?? null;
  const uploader = input.uploader ?? null;
  const list = await rows<DocumentRow & { in_thread: boolean }>(
    sql`SELECT d.*,
      (${thread}::text IS NOT NULL AND d.slack_channel = ${channel} AND d.slack_thread_ts = ${thread}) AS in_thread
     FROM documents d
     WHERE (${thread}::text IS NOT NULL AND d.slack_channel = ${channel} AND d.slack_thread_ts = ${thread})
        OR (${uploader}::text IS NOT NULL AND (${channel}::text IS NULL OR d.slack_channel = ${channel})
            AND (d.created_by = ${uploader} OR EXISTS
              (SELECT 1 FROM versions v WHERE v.document_id = d.id AND v.uploaded_by = ${uploader})))`,
  );
  return list.map((d) => ({ ...d, in_thread: Boolean(d.in_thread) }));
}

/** チャンネルのすべての原稿（Web から来た PDF は、すべての原稿）。本文がまったく同じ PDF を探すのに使う */
export async function documentsIn(channel?: string): Promise<Candidate[]> {
  const db = await getDb();
  const list = channel
    ? await db
        .select()
        .from(documents)
        .where(eq(documents.slack_channel, channel))
    : await db.select().from(documents);
  return list.map((d) => ({ ...d, in_thread: false }));
}

// ---------- 一覧 ----------

export type DocumentListRow = DocumentRow & {
  latest_version: number | null;
  latest_version_id: string | null;
  latest_layout: string | null;
  updated_at: string;
  comment_count: number;
  open_count: number;
};

/** 原稿の一覧。版をすべて消したが、提出先などが残っている原稿も含む */
export async function listDocuments() {
  const list = await rows<DocumentListRow>(
    sql`SELECT d.*,
      v.number AS latest_version, v.id AS latest_version_id, v.layout AS latest_layout,
      GREATEST(d.created_at, COALESCE(v.created_at, '')) AS updated_at,
      (SELECT COUNT(*) FROM comments c WHERE c.version_id = v.id AND c.parent_id IS NULL) AS comment_count,
      (SELECT COUNT(*) FROM comments c WHERE c.version_id = v.id AND c.parent_id IS NULL AND c.status = 'open') AS open_count
     FROM documents d
     LEFT JOIN versions v ON v.document_id = d.id
      AND v.number = (SELECT MAX(number) FROM versions WHERE document_id = d.id)
     ORDER BY updated_at DESC`,
  );
  return list.map((d) => ({
    ...d,
    latest_version: d.latest_version === null ? null : Number(d.latest_version),
    comment_count: Number(d.comment_count),
    open_count: Number(d.open_count),
  }));
}

// ---------- コメント ----------

function toComment(row: CommentRow): Comment {
  return { ...row, replies: [] };
}

export async function listComments(versionId: string): Promise<Comment[]> {
  const db = await getDb();
  const list = await db
    .select()
    .from(comments)
    .where(eq(comments.version_id, versionId))
    .orderBy(asc(comments.created_at));
  const byId = new Map(list.map((r) => [r.id, toComment(r)]));
  const roots: Comment[] = [];
  for (const c of byId.values()) {
    const parent = c.parent_id ? byId.get(c.parent_id) : undefined;
    if (parent) parent.replies.push(c);
    else roots.push(c);
  }
  return roots;
}

export async function getComment(id: string) {
  const db = await getDb();
  const [row] = await db.select().from(comments).where(eq(comments.id, id));
  return row && toComment(row);
}

export async function createComment(input: {
  versionId: string;
  parentId?: string;
  author: string;
  body: string;
  kind?: "text" | "area" | "general";
  quote?: string;
  position?: ApiComment["position"];
  copyId?: string;
  importKey?: string;
}) {
  const t = now();
  const db = await getDb();
  const [row] = await db
    .insert(comments)
    .values({
      id: newId(),
      version_id: input.versionId,
      parent_id: input.parentId ?? null,
      author: input.author,
      body: input.body,
      kind: input.parentId ? null : (input.kind ?? "text"),
      quote: input.quote ?? null,
      position: input.position ?? null,
      status: "open",
      created_at: t,
      updated_at: t,
      copy_id: input.copyId ?? null,
      import_key: input.importKey ?? null,
    })
    .returning();
  return toComment(row);
}

export async function updateComment(
  id: string,
  patch: { body?: string; status?: Status },
) {
  const current = await getComment(id);
  if (!current) return undefined;
  const db = await getDb();
  await db
    .update(comments)
    .set({
      body: patch.body ?? current.body,
      status: patch.status ?? current.status,
      updated_at: now(),
    })
    .where(eq(comments.id, id));
  return getComment(id);
}

export async function deleteComment(id: string) {
  const db = await getDb();
  const deleted = await db
    .delete(comments)
    .where(eq(comments.id, id))
    .returning({ id: comments.id });
  return deleted.length > 0;
}

export async function versionStats(versionId: string) {
  const [r] = await rows<{ total: number; open: number }>(
    sql`SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE status = 'open') AS open
     FROM comments WHERE version_id = ${versionId} AND parent_id IS NULL`,
  );
  return { total: Number(r.total), open: Number(r.open) };
}

export async function countByAuthor(versionId: string, author: string) {
  const [r] = await rows<{ n: number }>(
    sql`SELECT COUNT(*) AS n FROM comments WHERE version_id = ${versionId} AND author = ${author} AND parent_id IS NULL`,
  );
  return Number(r.n);
}

/** コメントを書いたことのある名前（新しい順）。名前を選ぶときの候補 */
export async function knownAuthors(): Promise<string[]> {
  const list = await rows<{ author: string }>(
    sql`SELECT author, MAX(created_at) AS last FROM comments GROUP BY author ORDER BY last DESC`,
  );
  return list.map((r) => r.author);
}

// ---------- 設定 ----------

export async function getSetting(key: string) {
  const db = await getDb();
  const [row] = await db.select().from(settings).where(eq(settings.key, key));
  return row?.value;
}

/** 初回アクセスが並行しても、一つの鍵だけを採用する。 */
export async function getOrCreateSetting(key: string, value: string) {
  const database = await getDb();
  await database.insert(settings).values({ key, value }).onConflictDoNothing();
  return (await getSetting(key))!;
}

export async function setSetting(key: string, value: string) {
  const db = await getDb();
  await db
    .insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } });
}

// ---------- 人 ----------

export async function getPerson(id: string) {
  const db = await getDb();
  const [row] = await db.select().from(people).where(eq(people.id, id));
  return row;
}

export async function getPersonBySlack(slackUserId: string) {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(people)
    .where(eq(people.slack_user_id, slackUserId));
  return row;
}

/** 名前（別の書き方も含む）から人を探す */
export async function findPersonByName(name: string) {
  const db = await getDb();
  for (const key of nameKeys(name)) {
    const [row] = await db
      .select({ person: people })
      .from(people)
      .innerJoin(person_names, eq(person_names.person_id, people.id))
      .where(eq(person_names.key, key))
      .limit(1);
    if (row) return row.person;
  }
  return undefined;
}

export async function addPersonName(personId: string, name: string) {
  const trimmed = name.trim();
  const key = nameKey(trimmed);
  if (!key) return;
  const db = await getDb();
  await db
    .insert(person_names)
    .values({ person_id: personId, name: trimmed, key })
    .onConflictDoNothing();
}

export async function allPersonNames() {
  const db = await getDb();
  const list = await db
    .select({ person_id: person_names.person_id, name: person_names.name })
    .from(person_names);
  return list.map((r) => [r.person_id, r.name] as [string, string]);
}

export async function createPerson(input: {
  name: string;
  slackUserId?: string;
}) {
  const db = await getDb();
  const [row] = await db
    .insert(people)
    .values({
      id: newId(),
      name: input.name.trim(),
      slack_user_id: input.slackUserId ?? null,
      created_at: now(),
    })
    .returning();
  await addPersonName(row.id, row.name);
  return row;
}

/** 名前の人を探し、いなければ作る */
export async function findOrCreatePerson(name: string) {
  return (await findPersonByName(name)) ?? createPerson({ name });
}

/** 人と Slack の利用者をつなぐ（別の人につながっていた Slack の利用者は付け替える） */
export async function linkSlackUser(personId: string, slackUserId: string) {
  const db = await getDb();
  await db
    .update(people)
    .set({ slack_user_id: null })
    .where(eq(people.slack_user_id, slackUserId));
  await db
    .update(people)
    .set({ slack_user_id: slackUserId })
    .where(eq(people.id, personId));
}

/** Slack の利用者に対応する人。いなければ作る。本名と表示名の両方を名前として覚える */
export async function personForSlackUser(slackUserId: string, names: string[]) {
  const known = names.map((n) => n.trim()).filter(Boolean);
  let person: PersonRow | undefined = await getPersonBySlack(slackUserId);
  if (!person) {
    for (const n of known) {
      person = await findPersonByName(n);
      if (person) break;
    }
  }
  if (!person) {
    if (!known.length) return undefined;
    person = await createPerson({ name: known[0], slackUserId });
  } else if (!person.slack_user_id) {
    await linkSlackUser(person.id, slackUserId);
  }
  for (const n of known) await addPersonName(person.id, n);
  return (await getPerson(person.id))!;
}

/** 覚えている名前のうち、姓名そろったローマ字の書き方（例 "Takahiro Koita"）。p は people の別名 */
const ROMAJI_ALIAS = sql`(SELECT n.name FROM person_names n WHERE n.person_id = p.id
  AND n.name ~ '^[A-Za-z][A-Za-z.''-]* [A-Za-z][A-Za-z.''-]*$' ORDER BY length(n.name) DESC LIMIT 1)`;

/** 人の一覧（原稿の多い順）。keys は、別の書き方（ローマ字など）も含めた照合用の形 */
export async function listPeople() {
  const list = await rows<
    PersonRow & { keys: string | null; papers: number; alias_en: string | null }
  >(
    sql`SELECT p.*,
      (SELECT string_agg(n.key, ' ') FROM person_names n WHERE n.person_id = p.id) AS keys,
      ${ROMAJI_ALIAS} AS alias_en,
      (SELECT COUNT(*) FROM document_authors a WHERE a.person_id = p.id) AS papers
     FROM people p ORDER BY papers DESC, p.name`,
  );
  return list.map((r) => ({
    id: r.id,
    name: r.name,
    name_en: r.name_en,
    /** ローマ字が入っていないとき、PDF の1ページ目などで覚えたローマ字の書き方 */
    name_en_guess: r.name_en ? null : r.alias_en,
    slack_user_id: r.slack_user_id,
    papers: Number(r.papers),
    keys: r.keys?.split(" ") ?? [],
  }));
}

export async function setPersonNameEn(personId: string, nameEn: string | null) {
  const db = await getDb();
  await db
    .update(people)
    .set({ name_en: nameEn })
    .where(eq(people.id, personId));
  if (nameEn) await addPersonName(personId, nameEn);
}

// ---------- 著者 ----------

export async function listAuthors(documentId: string): Promise<Author[]> {
  const db = await getDb();
  return db
    .select({ id: people.id, name: people.name })
    .from(document_authors)
    .innerJoin(people, eq(people.id, document_authors.person_id))
    .where(eq(document_authors.document_id, documentId))
    .orderBy(asc(document_authors.position));
}

/**
 * 著者（人の情報つき）。業績の書き出しでローマ字を使う。
 * ローマ字が入っていない人は、覚えているローマ字の書き方（姓名そろったもの）で補う
 */
export async function listAuthorPeople(
  documentId: string,
): Promise<PersonRow[]> {
  return rows<PersonRow>(
    sql`SELECT p.id, p.name, COALESCE(p.name_en, ${ROMAJI_ALIAS}) AS name_en, p.slack_user_id, p.created_at
     FROM document_authors a JOIN people p ON p.id = a.person_id
     WHERE a.document_id = ${documentId} ORDER BY a.position`,
  );
}

/** すべての原稿の著者（一覧用） */
export async function allAuthors() {
  const db = await getDb();
  const list = await db
    .select({
      document_id: document_authors.document_id,
      id: people.id,
      name: people.name,
    })
    .from(document_authors)
    .innerJoin(people, eq(people.id, document_authors.person_id))
    .orderBy(asc(document_authors.document_id), asc(document_authors.position));
  const byDocument = new Map<string, Author[]>();
  for (const { document_id, ...author } of list) {
    if (!byDocument.has(document_id)) byDocument.set(document_id, []);
    byDocument.get(document_id)!.push(author);
  }
  return byDocument;
}

/** 著者を並びの順に入れ直す。confirmed は人が確かめたかどうか */
export async function setAuthors(
  documentId: string,
  personIds: string[],
  confirmed: boolean,
) {
  const unique = [...new Set(personIds)];
  const db = await getDb();
  await db
    .delete(document_authors)
    .where(eq(document_authors.document_id, documentId));
  if (unique.length) {
    await db.insert(document_authors).values(
      unique.map((person_id, position) => ({
        document_id: documentId,
        person_id,
        position,
      })),
    );
  }
  if (confirmed) {
    await db
      .update(documents)
      .set({ authors_confirmed: 1 })
      .where(eq(documents.id, documentId));
  }
}

// ---------- 共著者の確認 ----------

export async function setApproval(versionId: string, personId: string) {
  const db = await getDb();
  const inserted = await db
    .insert(approvals)
    .values({ version_id: versionId, person_id: personId, created_at: now() })
    .onConflictDoNothing()
    .returning();
  return inserted.length > 0;
}

export async function approvalsFor(versionId: string) {
  const db = await getDb();
  return db.select().from(approvals).where(eq(approvals.version_id, versionId));
}

export async function approvalsForVersions(ids: string[]) {
  if (!ids.length) return [];
  const db = await getDb();
  return db
    .select({
      version_id: approvals.version_id,
      person_id: approvals.person_id,
    })
    .from(approvals)
    .where(inArray(approvals.version_id, ids));
}

export async function reminderWasSent(
  documentId: string,
  kind: string,
  deadline: string,
) {
  const db = await getDb();
  const [sent] = await db
    .select()
    .from(reminders_sent)
    .where(
      and(
        eq(reminders_sent.document_id, documentId),
        eq(reminders_sent.kind, kind),
        eq(reminders_sent.deadline, deadline),
      ),
    );
  return Boolean(sent);
}

export async function recordReminder(
  documentId: string,
  kind: string,
  deadline: string,
) {
  const db = await getDb();
  const claimed = await db
    .insert(reminders_sent)
    .values({ document_id: documentId, kind, deadline, sent_at: now() })
    .onConflictDoNothing()
    .returning();
  return claimed.length > 0;
}

/** 送信に失敗した通知だけ、次の実行で再試行できるようにする。 */
export async function releaseReminder(
  documentId: string,
  kind: string,
  deadline: string,
) {
  const db = await getDb();
  await db
    .delete(reminders_sent)
    .where(
      and(
        eq(reminders_sent.document_id, documentId),
        eq(reminders_sent.kind, kind),
        eq(reminders_sent.deadline, deadline),
      ),
    );
}
