// 原稿と版の変更。DB操作とファイル操作を組み合わせる業務上の判断。
import * as db from "./repo";
import { copyKey, deleteFiles, pdfKey } from "./storage";

async function fileKeysOf(
  scope: { documentId: string } | { versionId: string },
) {
  const { versionIds, copyIds } = await db.fileIdsOf(scope);
  return [...versionIds.map(pdfKey), ...copyIds.map(copyKey)];
}

export async function deleteCopy(id: string) {
  await db.deleteCopyRow(id);
  await deleteFiles([copyKey(id)]);
}

/** 最新版の題名に合わせる。手入力した題名は上書きしない。 */
export async function refreshDocumentTitle(
  documentId: string,
  fallback?: string,
) {
  const latest = await db.latestVersion(documentId);
  const title = latest?.title || fallback;
  if (title) await db.setAutomaticTitle(documentId, title);
}

export async function setDocumentTitle(documentId: string, title: string) {
  if (title) await db.updateDocument(documentId, { title, title_manual: 1 });
  else {
    await db.updateDocument(documentId, { title_manual: 0 });
    await refreshDocumentTitle(documentId);
  }
}

/** 最後の版を消しても、人が入力した情報があれば原稿を残す。 */
async function removeIfEmpty(documentId: string) {
  const d = await db.getDocument(documentId);
  if (!d) return true;
  if (await db.latestVersion(documentId)) return false;
  if (
    d.title_manual ||
    d.authors_confirmed ||
    d.venue ||
    d.deadline ||
    d.submitted_at
  )
    return false;
  await db.deleteDocumentRow(documentId);
  return true;
}

export async function deleteDocument(documentId: string) {
  const keys = await fileKeysOf({ documentId });
  const d = await db.getDocument(documentId);
  const deleted = await db.deleteDocumentRow(documentId);
  await deleteFiles(d?.receipt_key ? [...keys, d.receipt_key] : keys);
  return deleted;
}

export async function moveVersion(versionId: string, targetDocumentId: string) {
  const version = await db.getVersion(versionId);
  if (!version) return undefined;
  await db.moveVersionRow(versionId, targetDocumentId);
  if (!(await removeIfEmpty(version.document_id)))
    await refreshDocumentTitle(version.document_id);
  await refreshDocumentTitle(targetDocumentId);
  return (await db.getVersion(versionId))!;
}

export async function splitVersion(versionId: string) {
  const version = await db.getVersion(versionId);
  const from = version && (await db.getDocument(version.document_id));
  if (!version || !from) return undefined;
  const document = await db.createDocument({
    title: version.title || from.title,
    normalizedTitle: from.normalized_title,
    slackChannel: from.slack_channel ?? undefined,
    slackThreadTs: version.slack_ts ?? undefined,
    createdBy: version.uploaded_by ?? undefined,
  });
  return moveVersion(versionId, document.id);
}

export async function deleteVersion(versionId: string) {
  const version = await db.getVersion(versionId);
  if (!version) return undefined;
  const keys = await fileKeysOf({ versionId });
  await db.deleteVersionRow(versionId);
  await deleteFiles(keys);
  const documentDeleted = await removeIfEmpty(version.document_id);
  if (!documentDeleted) await refreshDocumentTitle(version.document_id);
  return { documentDeleted };
}
