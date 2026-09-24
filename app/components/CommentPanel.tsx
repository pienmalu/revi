"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { ScaledPosition } from "react-pdf-highlighter-plus";
import {
  STATUS_LABEL,
  api,
  formatDate,
  type Comment,
  type Status,
} from "@/app/lib/client/api";
import { DropMenu } from "@/app/components/DropMenu";
import { Icon } from "@/app/components/Icon";
import { askConfirm } from "@/app/components/Confirm";
import { Jp } from "@/app/components/Jp";

/** 保存前の選択。ghost は PDF 部品がゴーストとして描いているかどうか */
export type Pending = {
  kind: "text" | "area";
  quote?: string;
  position: ScaledPosition;
  ghost: boolean;
};
export type Filter = "all" | "open" | "done";
export type PanelTab = "comments" | "info";

type Props = {
  comments: Comment[];
  pending: Pending | null;
  activeId: string | null;
  author: string;
  filter: Filter;
  open: boolean;
  /** 横の欄に出すもの。コメントか、原稿の情報（著者・経歴など） */
  tab: PanelTab;
  onTab(tab: PanelTab): void;
  infoLabel: string;
  info: ReactNode;
  onToggle(): void;
  onFilter(filter: Filter): void;
  onSelect(comment: Comment): void;
  onCreate(body: string): Promise<void>;
  onCancelPending(): void;
  /** 場所を選ばない、全体へのコメントを書いている途中か */
  drafting: boolean;
  onDraft(open: boolean): void;
  onCreateGeneral(body: string): Promise<void>;
  onReply(parent: Comment, body: string): Promise<void>;
  onStatus(comment: Comment, status: Status): void;
  onEdit(comment: Comment, body: string): Promise<void>;
  onDelete(comment: Comment): void;
};

const URL_PATTERN = /(https?:\/\/[^\s<>"'）」]+)/g;

/** 本文の URL を押せるリンクにする（AI の添削結果の共有リンクなどを貼ったとき） */
function Body({ text }: { text: string }) {
  return (
    <p className="comment__body">
      {text.split(URL_PATTERN).map((part, i) =>
        i % 2 ? (
          <a
            key={i}
            href={part}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
          >
            {part}
          </a>
        ) : (
          part
        ),
      )}
    </p>
  );
}

const pageOf = (c: Comment) => c.position?.boundingRect.pageNumber ?? 0;

// 読む順番（ページ → 上から）に並べる
function byReadingOrder(a: Comment, b: Comment) {
  const page = pageOf(a) - pageOf(b);
  if (page !== 0) return page;
  const ya = a.position
    ? a.position.boundingRect.y1 / a.position.boundingRect.height
    : 0;
  const yb = b.position
    ? b.position.boundingRect.y1 / b.position.boundingRect.height
    : 0;
  return ya - yb;
}

export function CommentPanel(props: Props) {
  const { comments, pending, filter } = props;
  const open = comments.filter((c) => c.status === "open").length;
  const done = comments.length - open;
  const visible = comments
    .filter(
      (c) =>
        filter === "all" ||
        (filter === "open" ? c.status === "open" : c.status !== "open"),
    )
    .sort(byReadingOrder);

  const tabs = (
    <div className="panel__tabs" role="tablist" aria-label="横の欄">
      <button
        role="tab"
        aria-selected={props.tab === "comments"}
        onClick={() => props.onTab("comments")}
      >
        コメント {comments.length}
      </button>
      <button
        role="tab"
        aria-selected={props.tab === "info"}
        onClick={() => props.onTab("info")}
      >
        {props.infoLabel}
      </button>
    </div>
  );

  return (
    <aside
      className={`panel ${props.open ? "panel--open" : ""}`}
      aria-label={props.tab === "info" ? props.infoLabel : "コメント"}
    >
      <button
        className="panel__handle"
        onClick={props.onToggle}
        aria-expanded={props.open}
        aria-label={props.open ? "閉じる" : undefined}
      >
        <span className="panel__summary">
          {props.tab === "info"
            ? props.infoLabel
            : `コメント ${comments.length}`}
        </span>
        {open > 0 ? (
          <span className="status status--open">未対応 {open}</span>
        ) : (
          <span className="status">未対応なし</span>
        )}
      </button>
      {tabs}
      {props.tab === "info" ? (
        <div className="panel__scroll">{props.info}</div>
      ) : (
        <>
          <div className="panel__head">
            <div
              className="segmented"
              role="group"
              aria-label="表示するコメント"
            >
              {(
                [
                  ["all", `すべて ${comments.length}`],
                  ["open", `未対応 ${open}`],
                  ["done", `完了 ${done}`],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  aria-pressed={filter === key}
                  onClick={() => props.onFilter(key)}
                >
                  {label}
                </button>
              ))}
            </div>
            {!props.drafting && (
              <button
                className="link-btn"
                onClick={() => props.onDraft(true)}
                title="PDFの場所を選ばずに書く（AIの添削結果やリンクを貼るときにも）"
              >
                <Icon name="plus" /> 全体へのコメント
              </button>
            )}
          </div>
          <div className="panel__scroll">
            {props.drafting && (
              <Composer
                key="general"
                target={null}
                author={props.author}
                onSubmit={props.onCreateGeneral}
                onCancel={() => props.onDraft(false)}
              />
            )}
            {pending && (
              <Composer
                key={JSON.stringify(pending.position.boundingRect)}
                target={pending}
                author={props.author}
                onSubmit={props.onCreate}
                onCancel={props.onCancelPending}
              />
            )}
            {visible.length === 0 && !pending && !props.drafting ? (
              <p className="panel__hint">
                {comments.length === 0 ? (
                  <>
                    <Jp>
                      {
                        "PDFの文字をなぞると、その部分にコメントできます。\n図や表は「範囲」に切り替えて、四角で囲みます。"
                      }
                    </Jp>
                    <br />
                    <kbd>Alt</kbd>
                    <Jp>を押しながらドラッグしても囲めます。</Jp>
                  </>
                ) : (
                  "該当するコメントはありません。"
                )}
              </p>
            ) : (
              <ul className="comment-list">
                {visible.map((c) => (
                  <CommentCard key={c.id} comment={c} {...props} />
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </aside>
  );
}

function Composer({
  target,
  author,
  onSubmit,
  onCancel,
}: {
  /** null は全体へのコメント */
  target: Pending | null;
  author: string;
  onSubmit(body: string): Promise<void>;
  onCancel(): void;
}) {
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => ref.current?.focus({ preventScroll: true }), []);

  async function submit() {
    if (!body.trim() || busy) return;
    setBusy(true);
    try {
      await onSubmit(body.trim());
    } catch {
      // 通知は呼び出し側が出す。保存できなかった入力は残す。
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="composer"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <p className="composer__target">
        {!target ? (
          <Jp>全体へのコメント（AIの添削結果やリンクも可）</Jp>
        ) : target.kind === "area" ? (
          `図・表の範囲（p.${target.position.boundingRect.pageNumber}）`
        ) : (
          `「${target.quote}」`
        )}
      </p>
      <textarea
        ref={ref}
        className="field"
        rows={3}
        value={body}
        placeholder="コメントを書く"
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (
            e.key === "Enter" &&
            (e.metaKey || e.ctrlKey) &&
            !e.nativeEvent.isComposing
          )
            submit();
          if (e.key === "Escape") onCancel();
        }}
      />
      <div className="composer__row">
        <span className="composer__note">
          {author ? `${author} として投稿` : "投稿時に名前を聞きます"}
        </span>
        <button type="button" className="btn" onClick={onCancel}>
          キャンセル
        </button>
        <button
          type="submit"
          className="btn btn--primary"
          disabled={!body.trim() || busy}
        >
          コメント
        </button>
      </div>
    </form>
  );
}

function CommentCard({ comment: c, ...props }: Props & { comment: Comment }) {
  const [replying, setReplying] = useState(false);
  const [editing, setEditing] = useState(false);
  const active = props.activeId === c.id;
  const mine = props.author !== "" && props.author === c.author;

  return (
    <li
      id={`c-${c.id}`}
      className={`comment ${active ? "comment--active" : ""} ${c.status !== "open" ? "comment--done" : ""}`}
      onClick={() => props.onSelect(c)}
    >
      <div className="comment__head">
        <span className="comment__author">{c.author}</span>
        <span className="comment__time">
          {c.kind === "general" ? "全体" : `p.${pageOf(c)}`} ·{" "}
          {formatDate(c.created_at)}
        </span>
        <span
          className={`status ${c.status === "open" ? "status--open" : c.status === "resolved" ? "status--done" : ""}`}
        >
          {c.status === "resolved" && <Icon name="check" />}
          {STATUS_LABEL[c.status]}
        </span>
      </div>
      {c.kind === "area" ? (
        <p className="comment__quote">図・表の範囲</p>
      ) : (
        c.quote && <p className="comment__quote">{c.quote}</p>
      )}
      {c.copy_id && (
        <p className="comment__source">
          <a
            href={api.copyUrl(c.copy_id)}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
          >
            書き込みPDFを開く
          </a>
        </p>
      )}
      {editing ? (
        <InlineEditor
          initial={c.body}
          submitLabel="保存"
          onCancel={() => setEditing(false)}
          onSubmit={async (body) => {
            await props.onEdit(c, body);
            setEditing(false);
          }}
        />
      ) : (
        <Body text={c.body} />
      )}

      {c.replies.length > 0 && (
        <ul className="replies">
          {c.replies.map((r) => (
            <li key={r.id}>
              <div className="reply__head">
                <strong>{r.author}</strong>
                <span>{formatDate(r.created_at)}</span>
              </div>
              <Body text={r.body} />
            </li>
          ))}
        </ul>
      )}

      {replying ? (
        <InlineEditor
          initial=""
          submitLabel="返信"
          onCancel={() => setReplying(false)}
          onSubmit={async (body) => {
            await props.onReply(c, body);
            setReplying(false);
          }}
        />
      ) : (
        <div className="comment__actions" onClick={(e) => e.stopPropagation()}>
          {/* 返信は灰色、対応済みにするは青。済んだあとの「戻す」は目立たせない */}
          <button
            className="tint-btn tint-btn--gray"
            onClick={() => setReplying(true)}
          >
            返信
          </button>
          {c.status === "open" ? (
            <button
              className="tint-btn tint-btn--fill"
              onClick={() => props.onStatus(c, "resolved")}
            >
              <Icon name="check" />
              対応済みにする
            </button>
          ) : (
            <button
              className="tint-btn tint-btn--gray"
              onClick={() => props.onStatus(c, "open")}
            >
              未対応に戻す
            </button>
          )}
          {/* 自分のコメントの編集と削除は、ときどきしか使わないので「…」にまとめる */}
          {mine && (
            <DropMenu
              className="icon-btn comment__more"
              label={<Icon name="ellipsis" />}
              ariaLabel="そのほかの操作"
              items={[
                { label: "編集", onSelect: () => setEditing(true) },
                {
                  label: "削除",
                  danger: true,
                  onSelect: () =>
                    askConfirm("このコメントを削除しますか？", {
                      ok: "削除",
                      danger: true,
                    }).then((yes) => {
                      if (yes) props.onDelete(c);
                    }),
                },
              ]}
            />
          )}
        </div>
      )}
    </li>
  );
}

function InlineEditor({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: string;
  submitLabel: string;
  onSubmit(body: string): Promise<void>;
  onCancel(): void;
}) {
  const [body, setBody] = useState(initial);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!body.trim() || busy) return;
    setBusy(true);
    try {
      await onSubmit(body.trim());
    } catch {
      // 失敗の知らせは呼び出し側が出す。入力は消さずに残す
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="composer composer--inline"
      onClick={(e) => e.stopPropagation()}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <textarea
        className="field"
        rows={2}
        value={body}
        autoFocus
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (
            e.key === "Enter" &&
            (e.metaKey || e.ctrlKey) &&
            !e.nativeEvent.isComposing
          )
            submit();
          if (e.key === "Escape") onCancel();
        }}
      />
      <div className="composer__row">
        <button type="button" className="btn" onClick={onCancel}>
          キャンセル
        </button>
        <button
          type="submit"
          className="btn btn--primary"
          disabled={!body.trim() || busy}
        >
          {submitLabel}
        </button>
      </div>
    </form>
  );
}
