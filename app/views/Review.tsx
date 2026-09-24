"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useFlash, useNav } from "@/app/lib/client/nav";
import type { PdfWorkspaceHandle } from "@/app/components/PdfWorkspace";
import { useDocument } from "@/app/lib/client/use-document";
import { useComments } from "@/app/lib/client/use-comments";
import {
  CommentPanel,
  type Filter,
  type PanelTab,
  type Pending,
} from "@/app/components/CommentPanel";
import { NameDialog } from "@/app/components/NameDialog";
import { PaperInfo } from "@/app/components/PaperInfo";
import { useToast } from "@/app/components/Toast";
import { VersionMenu } from "@/app/components/VersionMenu";
import { DropMenu } from "@/app/components/DropMenu";
import {
  annotatedMessage,
  api,
  type Comment,
  type Person,
} from "@/app/lib/client/api";
import { nameKeys } from "@/app/lib/names";
import { useAuthor } from "@/app/lib/client/author";
import { askConfirm } from "@/app/components/Confirm";
import { Icon } from "@/app/components/Icon";
import { Jp } from "@/app/components/Jp";

const PdfWorkspace = dynamic(
  () => import("@/app/components/PdfWorkspace").then((m) => m.PdfWorkspace),
  { ssr: false },
);

const isNarrow = () => window.matchMedia("(max-width: 899px)").matches;

export function Review() {
  const { id: documentId = "" } = useParams<{ id: string }>();
  return <ReviewDocument key={documentId} documentId={documentId} />;
}

function ReviewDocument({ documentId }: { documentId: string }) {
  const params = useSearchParams();
  const router = useRouter();
  // 版を切り替えるときは、検索条件をその版だけにする
  const setParams = useCallback(
    (next: Record<string, string>) => {
      const q = new URLSearchParams(next).toString();
      router.replace(q ? `?${q}` : `/d/${documentId}`, { scroll: false });
    },
    [router, documentId],
  );
  const {
    document: doc,
    error: loadError,
    reload: loadDocument,
  } = useDocument(documentId);
  const [meta, setMeta] = useState<{ slack: boolean; authors: string[] }>({
    slack: false,
    authors: [],
  });
  const [people, setPeople] = useState<Person[]>([]);
  const [author, setAuthor] = useAuthor();
  const [askName, setAskName] = useState(false);
  const afterName = useRef<((name: string | null) => void) | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [sheetOpen, setSheetOpen] = useState(false);
  // 横の欄の初めはコメント。?tab=info のときだけ原稿の情報（切り替えたら、それを覚える）
  const [chosenTab, setTab] = useState<PanelTab | null>(null);
  const [toast, showToast] = useToast();
  const pdf = useRef<PdfWorkspaceHandle | null>(null);
  const navigate = useNav();

  // 一覧から PDF を追加したときの結果を知らせる
  useFlash(showToast);
  const versionInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.meta().then(setMeta, () => {});
    api.people().then(setPeople, () => {});
  }, []);

  const tab: PanelTab =
    chosenTab ?? (params.get("tab") === "info" ? "info" : "comments");

  const requested = Number(params.get("v"));
  const version =
    doc?.versions.find((v) => v.number === requested) ?? doc?.versions.at(-1);
  const versionId = version?.id;
  const commentData = useComments(versionId, showToast);
  const { comments } = commentData;
  const commentsRef = useRef(comments);
  useEffect(() => {
    commentsRef.current = comments;
  }, [comments]);
  useEffect(() => {
    // 版を切り替えたら、その版に属する選択と入力欄を閉じる。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPending(null);
    setActiveId(null);
    setDrafting(false);
  }, [versionId]);

  /** 名前が未設定なら先に聞く。キャンセルされたら null を返す。 */
  const requireAuthor = useCallback((): Promise<string | null> => {
    if (author) return Promise.resolve(author);
    return new Promise((resolve) => {
      afterName.current = resolve;
      setAskName(true);
    });
  }, [author]);

  // いまの名前の人（名前の書き方の違いは同じ人とみなす）。確認OKを出す人かどうかに使う
  const me = useMemo(() => {
    if (!author) return undefined;
    const keys = nameKeys(author);
    return people.find((p) => p.keys.some((k) => keys.includes(k)));
  }, [author, people]);
  const myTurn = Boolean(
    doc &&
    !doc.document.submitted_at &&
    me &&
    doc.review.people.some((p) => p.id === me.id && !p.ok),
  );

  async function approve() {
    if (!doc) return;
    try {
      await api.approve(doc.document.id, author!);
      await loadDocument();
      showToast("確認OKを送りました");
    } catch (e) {
      showToast((e as Error).message);
    }
  }

  const selectFromPdf = useCallback((id: string) => {
    setActiveId(id);
    // 選んだコメントが絞り込みで隠れていたら「すべて」に戻す
    setFilter((f) => {
      const c = commentsRef.current.find((x) => x.id === id);
      const hidden =
        c &&
        ((f === "open" && c.status !== "open") ||
          (f === "done" && c.status === "open"));
      return hidden ? "all" : f;
    });
    setTab("comments");
    setSheetOpen(true);
    requestAnimationFrame(() =>
      document
        .getElementById(`c-${id}`)
        ?.scrollIntoView({ block: "nearest", behavior: "smooth" }),
    );
  }, []);

  function handlePending(next: Pending | null) {
    setPending(next);
    if (next) {
      setActiveId(null);
      setTab("comments");
      setSheetOpen(true);
    }
  }

  function selectFromPanel(comment: Comment) {
    setActiveId(comment.id);
    pdf.current?.selectComment(comment);
    if (isNarrow()) setSheetOpen(false);
  }

  function cancelPending() {
    pdf.current?.clearSelection();
    setPending(null);
  }

  async function createComment(body: string) {
    if (!pending) return;
    const { kind, quote, position } = pending;
    const name = await requireAuthor();
    if (!name) throw new Error("名前が必要です");
    const created = await commentData.create({
      author: name,
      body,
      kind,
      quote,
      position,
    });
    if (!created) return;
    setActiveId(created.id);
    cancelPending();
  }

  async function createGeneral(body: string) {
    const name = await requireAuthor();
    if (!name) throw new Error("名前が必要です");
    const created = await commentData.create({
      author: name,
      body,
      kind: "general",
    });
    if (!created) return;
    setActiveId(created.id);
    setDrafting(false);
  }

  async function reply(parent: Comment, body: string) {
    const name = await requireAuthor();
    if (!name) throw new Error("名前が必要です");
    await commentData.create({ author: name, body, parentId: parent.id });
  }

  async function uploadVersion(file: File) {
    try {
      const res = await api.upload(file, {
        author: author || undefined,
        documentId,
      });
      await loadDocument();
      setParams({ v: String(res.version.number) });
      if (res.annotated) {
        // 書き込みPDFだったときは、取り込んだ版のコメントを見せる
        setTab("comments");
        if (res.version.id === versionId) await commentData.reload();
      }
      showToast(
        annotatedMessage(res) ??
          (res.duplicate
            ? `v${res.version.number} と同じファイルでした`
            : `v${res.version.number} を追加しました`),
      );
    } catch (e) {
      showToast((e as Error).message);
    }
  }

  async function deleteVersion() {
    if (!version || !doc) return;
    const comments =
      version.comment_count > 0
        ? `この版のコメント ${version.comment_count} 件も消えます。`
        : "";
    const last =
      doc.versions.length === 1
        ? "版がなくなるので、原稿ごと一覧から消えます。"
        : "";
    const yes = await askConfirm(
      [
        `v${version.number} を削除しますか？`,
        comments,
        last,
        "Slack 上の PDF はそのまま残ります。",
      ]
        .filter(Boolean)
        .join("\n"),
      {
        ok: "削除",
        danger: true,
      },
    );
    if (!yes) return;
    try {
      const { documentDeleted } = await api.deleteVersion(version.id);
      if (documentDeleted)
        return navigate("/", { replace: true, toast: "原稿を削除しました" });
      await loadDocument();
      setParams({});
      showToast(`v${version.number} を削除しました`);
    } catch (e) {
      showToast((e as Error).message);
    }
  }

  async function moveVersion(targetId?: string) {
    if (!version) return;
    try {
      const moved = await api.moveVersion(version.id, targetId);
      const toast = targetId
        ? `v${moved.number} として移しました`
        : "新しい原稿として切り離しました";
      navigate(`/d/${moved.documentId}?v=${moved.number}`, { toast });
    } catch (e) {
      showToast((e as Error).message);
    }
  }

  async function dismissSuggestion() {
    if (!version) return;
    await api.dismissSuggestion(version.id).catch(() => {});
    await loadDocument();
  }

  if (loadError) {
    return (
      <div className="review">
        <header className="topbar">
          <Link className="topbar__back" href="/">
            <Icon name="chevronLeft" />
            一覧
          </Link>
        </header>
        <p className="stage__message">{loadError}</p>
      </div>
    );
  }

  const info = doc && (
    <PaperInfo
      detail={doc}
      requireAuthor={requireAuthor}
      onChanged={loadDocument}
      onToast={showToast}
    />
  );

  const versionPicker = (
    <input
      ref={versionInput}
      type="file"
      accept="application/pdf"
      hidden
      onChange={(e) => {
        const file = e.target.files?.[0];
        e.target.value = "";
        if (file) uploadVersion(file);
      }}
    />
  );

  // 版をすべて消した原稿（提出先などは残してある）は、原稿の情報だけのページにする
  if (doc && doc.versions.length === 0) {
    return (
      <div className="home">
        <header className="topbar">
          <Link className="topbar__back" href="/" aria-label="原稿の一覧に戻る">
            <Icon name="chevronLeft" />
            一覧
          </Link>
          <div className="topbar__spacer" />
          <div className="topbar__actions">
            <button
              className="btn"
              onClick={() => versionInput.current?.click()}
            >
              PDFを追加
            </button>
            {versionPicker}
          </div>
        </header>
        <main className="home__inner home__inner--narrow">
          <section className="card card--pad">{info}</section>
        </main>
        {toast}
      </div>
    );
  }

  return (
    <div className="review">
      <header className="topbar">
        <Link className="topbar__back" href="/" aria-label="原稿の一覧に戻る">
          <Icon name="chevronLeft" />
          一覧
        </Link>
        <h1 className="topbar__title">
          {doc ? (
            <button
              className="topbar__title-btn"
              onClick={() => {
                setTab("info");
                setSheetOpen(true);
              }}
              title={
                doc.review.stage === "slides"
                  ? "スライドの情報を見る"
                  : "原稿の情報を見る"
              }
            >
              {doc.document.title}
            </button>
          ) : (
            "読み込み中…"
          )}
        </h1>
        <div className="topbar__actions">
          {doc?.document.slack_url && (
            <a
              className="link-btn link-btn--nav slack-link"
              href={doc.document.slack_url}
              target="_blank"
              rel="noreferrer"
            >
              Slackで開く
            </a>
          )}
          <button
            className="link-btn link-btn--muted who"
            onClick={() => setAskName(true)}
            title="コメントに表示される名前（クリックで変更）"
          >
            {author || "名前を設定"}
          </button>
          {myTurn && version?.id === doc?.versions.at(-1)?.id && (
            <button className="btn btn--primary" onClick={approve}>
              確認OK
            </button>
          )}
        </div>
      </header>

      <PdfWorkspace
        ref={pdf}
        versionId={versionId}
        comments={comments}
        pending={pending}
        activeId={activeId}
        onPending={handlePending}
        onSelect={selectFromPdf}
        toolbar={
          <div className="toolbar__group">
            {/* 版は増えても幅が変わらないよう、押すと一覧が出るボタンにする */}
            {doc && version && (
              <DropMenu
                className="popup-btn"
                ariaLabel="版を選ぶ"
                label={
                  <>
                    v{version.number}
                    <Icon name="chevronDown" />
                  </>
                }
                items={[...doc.versions].reverse().map((v) => ({
                  label: `v${v.number}　${v.uploaded_by ?? ""}`.trim(),
                  checked: v.id === version.id,
                  onSelect: () => setParams({ v: String(v.number) }),
                }))}
              />
            )}
            <button
              className="icon-btn icon-btn--tool"
              onClick={() => versionInput.current?.click()}
              aria-label="新しい版を追加"
              title="新しい版を追加"
            >
              <Icon name="plus" />
            </button>
            {version && doc && (
              <VersionMenu
                documentId={documentId}
                downloadUrl={`${api.pdfUrl(version.id)}?download=1`}
                commentsDownloadUrl={`/api/versions/${version.id}/comments/markdown`}
                versionNumber={version.number}
                canSplit={doc.versions.length > 1}
                onDelete={deleteVersion}
                onSplit={() => {
                  askConfirm(
                    `v${version.number} を別の原稿にしますか？\nこの版を切り離して、新しい原稿にします。\nコメントも一緒に移ります。`,
                    {
                      ok: "別の原稿にする",
                    },
                  ).then((yes) => {
                    if (yes) moveVersion();
                  });
                }}
                onMove={(id) => moveVersion(id)}
              />
            )}
            {versionPicker}
          </div>
        }
        notice={
          version?.suggested_document_id && (
            <div className="suggestion" role="status">
              <p>
                <Jp>
                  {`本文が「${version.suggested_title}」と似ています。\n同じ原稿の新しい版ですか？`}
                </Jp>
              </p>
              <button
                className="btn btn--primary"
                onClick={() => moveVersion(version.suggested_document_id!)}
              >
                その原稿の版にする
              </button>
              <button className="btn" onClick={dismissSuggestion}>
                別の原稿です
              </button>
            </div>
          )
        }
      >
        <CommentPanel
          key={versionId}
          comments={comments}
          pending={pending}
          activeId={activeId}
          author={author}
          filter={filter}
          open={sheetOpen}
          tab={tab}
          onTab={setTab}
          infoLabel={
            doc?.review.stage === "slides" ? "スライドの情報" : "原稿の情報"
          }
          info={info}
          onPrepareOpen={() => pdf.current?.prepareSelection()}
          onToggle={() => {
            if (!sheetOpen) pdf.current?.finishSelection();
            setSheetOpen(!sheetOpen);
          }}
          onFilter={setFilter}
          onSelect={selectFromPanel}
          onCreate={createComment}
          onCancelPending={cancelPending}
          drafting={drafting}
          onDraft={setDrafting}
          onCreateGeneral={createGeneral}
          onReply={reply}
          onStatus={(comment, status) => {
            void commentData.update(comment, { status }).catch(() => {});
          }}
          onEdit={async (comment, body) => {
            await commentData.update(comment, { body });
          }}
          onDelete={(comment) => {
            void commentData.remove(comment).catch(() => {});
          }}
        />
      </PdfWorkspace>

      <NameDialog
        open={askName}
        initial={author}
        suggestions={[
          ...new Set([
            ...(doc?.authors.map((p) => p.name) ?? []),
            ...meta.authors,
          ]),
        ]
          .filter((a) => a !== author)
          .slice(0, 8)}
        onClose={() => {
          setAskName(false);
          afterName.current?.(null);
          afterName.current = null;
        }}
        onSubmit={(name) => {
          setAuthor(name);
          setAskName(false);
          const action = afterName.current;
          afterName.current = null;
          action?.(name);
        }}
      />
      {toast}
    </div>
  );
}
