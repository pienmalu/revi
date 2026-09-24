// Slack に送られた PDF の受け取りと、その場で直すボタン（取り消し・切り離し・まとめる）。
import { config } from "../config";
import * as documentActions from "../document-actions";
import { IngestError, ingestPdf } from "../ingest";
import * as db from "../repo";
import {
  actionButton,
  openButton,
  post,
  replace,
  reviewUrl,
  short,
  slack,
  slackUser,
  userName,
  type Button,
} from "./core";
import { approveButton, staleReviewNote } from "./notifications";

// 原稿ではない PDF や、送り間違いをその場で取り消せるようにする
export const undoButton = (versionId: string) =>
  actionButton("登録を取り消す", "undo_version", versionId, {
    confirm: {
      title: "登録を取り消しますか？",
      body: "この版と、この版に付いたコメントが消えます。Slack上のPDFはそのまま残ります。",
      ok: "取り消す",
    },
  });

// 本文が似ていて自動で版にしたが、実は別の原稿だったとき
export const splitButton = (versionId: string) =>
  actionButton("別の原稿にする", "split_version", versionId, {
    confirm: {
      title: "別の原稿にしますか？",
      body: "この版を切り離して、新しい原稿として扱います。この版のコメントも一緒に移ります。",
      ok: "別の原稿にする",
    },
  });

export async function versionMessage(
  document: db.DocumentRow,
  version: db.VersionRow,
  uploader?: string,
) {
  const previous = (await db.listVersions(document.id))
    .filter((v) => v.number < version.number)
    .at(-1);
  const carry =
    previous && previous.open_count > 0
      ? `前の版の未対応コメントは ${previous.open_count} 件です。`
      : "";
  const by =
    uploader && uploader !== document.created_by
      ? `（${uploader} さんが送った版）`
      : "";
  return `📄 *${document.title}* の v${version.number} を登録しました${by}。${carry}`;
}

export type SlackFile = {
  id: string;
  name?: string;
  filetype?: string;
  mimetype?: string;
  size?: number;
  url_private_download?: string;
};

export type SlackMessage = {
  channel: string;
  ts: string;
  thread_ts?: string;
  user?: string;
};

const MAX_BYTES = 100 * 1024 * 1024; // 画面から送るときと同じ上限

async function download(file: SlackFile) {
  // 大きなファイルなどでは、イベントにダウンロード先が付いてこないことがある
  const info = file.url_private_download
    ? file
    : ((await slack().files.info({ file: file.id })).file as SlackFile);
  if (!info?.url_private_download)
    throw new Error("ダウンロード先が分かりません");
  if ((info.size ?? 0) > MAX_BYTES)
    throw new IngestError("100MB より大きい PDF は登録できません");
  const res = await fetch(info.url_private_download, {
    headers: { Authorization: `Bearer ${config.slackBotToken}` },
  });
  if (!res.ok)
    throw new Error(`PDFのダウンロードに失敗しました: ${res.status}`);
  return {
    buffer: Buffer.from(await res.arrayBuffer()),
    name: info.name ?? file.name ?? "untitled.pdf",
  };
}

export async function handlePdf(
  file: SlackFile,
  msg: SlackMessage,
  force = false,
) {
  // 再送イベントの二重登録を防ぐ
  if (await db.findVersionBySlackFile(file.id)) return;
  const copy = await db.findCopy({ slackFileId: file.id });
  if (copy) {
    if (!force) return;
    await documentActions.deleteCopy(copy.id); // 書き込みPDFとして保存したものを、新しい版として登録し直す
  }
  const { buffer, name } = await download(file);
  const user = await slackUser(msg.user);
  const uploader = user?.name;
  const result = await ingestPdf({
    buffer,
    filename: name,
    uploadedBy: uploader,
    uploaderId: user?.personId,
    slack: {
      channel: msg.channel,
      threadTs: msg.thread_ts,
      messageTs: msg.ts,
      fileId: file.id,
    },
    force,
  });
  const { document, version } = result;
  const url = await reviewUrl(document.id, version.number);
  const here = msg.thread_ts ?? msg.ts;
  const docThread = document.slack_thread_ts ?? msg.ts;

  if (result.duplicate) {
    await post(
      msg.channel,
      here,
      `この PDF は *${document.title}* の v${version.number} と同じファイルです。新しい版にはしていません。`,
      [openButton(url)],
    );
    return;
  }
  if (result.annotated) {
    const { count, alreadyImported, latestNumber } = result.annotated;
    const older =
      latestNumber > version.number
        ? `（いまの最新は v${latestNumber} です）`
        : "";
    const who = uploader ? `${uploader} さんが送った` : "送られた";
    if (alreadyImported) {
      await post(
        msg.channel,
        here,
        `この書き込みPDFは、すでに *${document.title}* の v${version.number} に取り込んであります。`,
        [openButton(url)],
      );
      return;
    }
    const message = count
      ? `📝 ${who}書き込みPDFから、${count} 件の書き込みを *${document.title}* の v${version.number} のコメントとして取り込みました${older}。`
      : `📎 ${who}PDFは *${document.title}* の v${version.number} と本文が同じなので、書き込みPDFとして保存しました${older}。書き込みは読み取れませんでした（手書きを画像にしたPDFなど）。本文を直した新しい版なら、下のボタンで登録し直せます。`;
    // 本文を変えずに直した新しい版だったときのために、版として登録し直せるようにしておく
    const value = JSON.stringify({
      file: file.id,
      ts: msg.ts,
      thread: msg.thread_ts,
      user: msg.user,
    });
    const buttons = count
      ? [openButton(url)]
      : [
          openButton(url),
          actionButton("新しい版として登録", "force_version", value),
        ];
    await post(msg.channel, docThread, message, buttons);
    if (here !== docThread) await post(msg.channel, here, message, buttons);
    return;
  }

  let message: string;
  let buttons: Button[];
  if (result.suggestion) {
    const s = result.suggestion;
    message = `📄 *${document.title}* を新しい原稿として登録しました。\n本文が *${s.title}* と似ています。同じ原稿の新しい版なら、下のボタンでまとめてください。`;
    buttons = [
      openButton(url),
      actionButton(
        `「${short(s.title)}」の版にする`,
        "merge_version",
        `${version.id}|${s.id}`,
      ),
      undoButton(version.id),
    ];
  } else if (result.isNewDocument) {
    message = `📄 *${document.title}* を新しい原稿として登録しました（v1）。`;
    buttons = [
      openButton(url),
      ...(version.layout === "landscape" ? [] : [approveButton(document.id)]),
      undoButton(version.id),
    ];
  } else {
    message = await versionMessage(document, version, uploader);
    const stale = await staleReviewNote(document, version);
    if (stale) message += `\n${stale}`;
    buttons = [
      openButton(url),
      ...(version.layout === "landscape" ? [] : [approveButton(document.id)]),
      splitButton(version.id),
      undoButton(version.id),
    ];
  }
  await post(msg.channel, docThread, message, buttons);
  // 別スレッドの原稿の版にしたときは、投稿された側にも知らせる
  if (here !== docThread) {
    await post(
      msg.channel,
      here,
      `${message}\n（前に送られた原稿の続きとして扱いました）`,
      buttons,
    );
  }
}

export async function reportFailure(
  file: SlackFile,
  where: SlackMessage,
  err: unknown,
) {
  console.error("[slack] PDF の登録に失敗しました", err);
  const reason =
    err instanceof IngestError ? err.message : "サーバーで問題が起きました";
  await post(
    where.channel,
    where.thread_ts ?? where.ts,
    `⚠️ 「${file.name ?? "PDF"}」を登録できませんでした（${reason}）。`,
  ).catch(() => {});
}

export type ActionBody = {
  user: { id: string };
  channel?: { id: string };
  message?: { ts: string };
  container?: { channel_id?: string; message_ts?: string };
  trigger_id?: string;
};

export const whereOf = (b: ActionBody) => ({
  channel: b.channel?.id ?? b.container?.channel_id,
  ts: b.message?.ts ?? b.container?.message_ts,
});

const ALREADY_GONE = "この登録はすでに取り消されたか、移されています。";

export async function undoVersion(b: ActionBody, versionId: string) {
  const version = await db.getVersion(versionId);
  if (!version) return replace(whereOf(b), ALREADY_GONE);
  const document = await db.getDocument(version.document_id);
  await documentActions.deleteVersion(version.id);
  await replace(
    whereOf(b),
    `↩️ ${await userName(b.user.id)} さんが *${document?.title ?? "PDF"}* の v${version.number} の登録を取り消しました。`,
  );
}

export async function mergeVersion(b: ActionBody, value: string) {
  const [versionId, targetId] = value.split("|");
  const target = await db.getDocument(targetId);
  if (!(await db.getVersion(versionId)) || !target)
    return replace(whereOf(b), ALREADY_GONE);
  const moved = (await documentActions.moveVersion(versionId, target.id))!;
  const document = (await db.getDocument(target.id))!;
  const message = `${await versionMessage(document, moved, moved.uploaded_by ?? undefined)}（${await userName(b.user.id)} さんがまとめました）`;
  const buttons = [
    openButton(await reviewUrl(document.id, moved.number)),
    ...(moved.layout === "landscape" ? [] : [approveButton(document.id)]),
    splitButton(moved.id),
    undoButton(moved.id),
  ];
  await replace(whereOf(b), message, buttons);
  // まとめ先の原稿のスレッドにも知らせる
  if (
    document.slack_channel &&
    document.slack_thread_ts &&
    document.slack_thread_ts !== moved.slack_ts
  ) {
    await post(
      document.slack_channel,
      document.slack_thread_ts,
      message,
      buttons,
    );
  }
}

export async function splitVersionAction(b: ActionBody, versionId: string) {
  const version = await db.getVersion(versionId);
  if (!version) return replace(whereOf(b), ALREADY_GONE);
  const moved = (await documentActions.splitVersion(version.id))!;
  const document = (await db.getDocument(moved.document_id))!;
  await replace(
    whereOf(b),
    `📄 *${document.title}* を新しい原稿として登録し直しました（${await userName(b.user.id)} さんが切り離しました）。`,
    [
      openButton(await reviewUrl(document.id, moved.number)),
      undoButton(moved.id),
    ],
  );
}

export async function forceVersion(b: ActionBody, value: string) {
  const v = JSON.parse(value) as {
    file: string;
    ts: string;
    thread?: string;
    user?: string;
  };
  const where = {
    channel: whereOf(b).channel!,
    ts: v.ts,
    thread_ts: v.thread,
    user: v.user,
  };
  try {
    await handlePdf({ id: v.file }, where, true);
    await replace(whereOf(b), "新しい版として登録しました。");
  } catch (err) {
    await reportFailure({ id: v.file }, where, err);
  }
}
