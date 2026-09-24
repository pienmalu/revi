"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useNav } from "@/app/lib/client/nav";
import {
  api,
  type DocumentDetail,
  type PaperFields,
} from "@/app/lib/client/api";
import { daysLeft, formatShort } from "@/app/lib/client/papers";
import { AuthorEditor } from "@/app/components/AuthorEditor";
import { askConfirm } from "@/app/components/Confirm";
import { Icon } from "@/app/components/Icon";
import { Jp } from "@/app/components/Jp";

type Props = {
  detail: DocumentDetail;
  requireAuthor(): Promise<string | null>;
  onChanged(): Promise<unknown>;
  onToast(message: string): void;
};

/**
 * 原稿の情報。iPhone の「設定」と同じ、白い欄のまとまり（グループ）を上から並べる。
 * 投稿（著者・提出先・締切）→ 確認 → 提出 →（提出のあと）業績。入力は変えたらその場で保存する。
 */
export function PaperInfo({
  detail,
  requireAuthor,
  onChanged,
  onToast,
}: Props) {
  const { document: doc, versions, authors, review } = detail;
  const [editingTitle, setEditingTitle] = useState(false);
  const [editingAuthors, setEditingAuthors] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNav();
  const slides = review.stage === "slides";
  const submitted = Boolean(doc.submitted_at);
  const latest = versions.at(-1);

  const run = async (action: () => Promise<unknown>, message?: string) => {
    try {
      await action();
      await onChanged();
      if (message) onToast(message);
    } catch (e) {
      onToast((e as Error).message);
    }
  };
  const save = (patch: Partial<PaperFields>) =>
    run(() => api.updatePaper(doc.id, patch));

  async function remove() {
    const pdfs = versions.length
      ? `\nPDF ${versions.length} 版とそのコメントも削除されます。\nSlack 上の PDF は残ります。`
      : "";
    if (
      !(await askConfirm(`「${doc.title}」を削除しますか？${pdfs}`, {
        ok: "削除",
        danger: true,
      }))
    )
      return;
    try {
      await api.deleteDocument(doc.id);
      navigate("/", {
        replace: true,
        toast: slides ? "スライドを削除しました" : "原稿を削除しました",
      });
    } catch (e) {
      onToast((e as Error).message);
    }
  }

  async function undoSubmission() {
    if (
      await askConfirm("提出の報告を取り消しますか？", {
        ok: "取り消す",
        danger: true,
      })
    )
      await run(() => api.undoSubmission(doc.id));
  }

  const left = doc.deadline ? daysLeft(doc.deadline) : null;
  const submittedVersion = versions.find(
    (v) => v.id === doc.submitted_version_id,
  );
  const okCount = review.people.filter((p) => p.ok).length;

  return (
    <div className="info">
      {editingTitle ? (
        <TitleEditor
          initial={doc.title}
          canReset={Boolean(doc.title_manual && versions.length)}
          onCancel={() => setEditingTitle(false)}
          onSubmit={(title) =>
            run(async () => {
              await api.renameDocument(doc.id, title);
              setEditingTitle(false);
            })
          }
        />
      ) : (
        <div className="info__title-row">
          <h2 className="info__title">{doc.title}</h2>
          <button className="link-btn" onClick={() => setEditingTitle(true)}>
            編集
          </button>
        </div>
      )}

      <Group
        footer={
          authors.length > 0 && !doc.authors_confirmed && !editingAuthors
            ? "著者はPDFから自動入力しました。"
            : undefined
        }
      >
        {editingAuthors ? (
          <div className="group__row group__row--stack">
            <AuthorEditor
              authors={authors}
              header={latest?.header ?? null}
              onCancel={() => setEditingAuthors(false)}
              onSave={(list) =>
                run(async () => {
                  await api.setAuthors(doc.id, list);
                  setEditingAuthors(false);
                })
              }
            />
          </div>
        ) : (
          <div className="group__row">
            <span className="group__label">著者</span>
            <span className="group__value group__value--wrap">
              {authors.length ? (
                authors.map((a) => a.name).join("、")
              ) : (
                <span className="muted">未設定</span>
              )}
            </span>
            <button
              className="link-btn"
              onClick={() => setEditingAuthors(true)}
            >
              {authors.length ? "編集" : "追加"}
            </button>
          </div>
        )}
        {!slides && (
          <>
            <LineField
              key={`venue:${doc.venue ?? ""}`}
              label="提出先"
              value={doc.venue}
              placeholder="未設定"
              onSave={(v) => save({ venue: v })}
            />
            <label className="group__row">
              <span className="group__label">締切</span>
              <span className="group__value">
                {!submitted && left !== null && (
                  <span
                    className={`deadline__note ${left < 0 ? "deadline--over" : left <= 7 ? "deadline--soon" : ""}`}
                  >
                    {left < 0
                      ? "締切超過"
                      : left === 0
                        ? "今日"
                        : `あと${left}日`}
                  </span>
                )}
                <input
                  className="group__input group__input--date"
                  type="date"
                  value={doc.deadline ?? ""}
                  onChange={(e) => save({ deadline: e.target.value || null })}
                />
              </span>
            </label>
          </>
        )}
      </Group>

      {!slides && (
        <>
          <Group
            header={
              review.people.length
                ? `確認 ${okCount}/${review.people.length}${latest ? `（v${latest.number}）` : ""}`
                : "確認"
            }
            footer={
              submitted
                ? undefined
                : review.people.length
                  ? "筆頭著者以外の全員の確認が必要です。\n新しい版を追加すると、確認はやり直しになります。"
                  : "共著者を著者に追加すると、ここに並びます。"
            }
          >
            {review.people.map((p) => (
              <div key={p.id} className="group__row">
                <span className="group__label group__label--text">
                  {p.name}
                </span>
                {p.ok ? (
                  <span className="group__check" aria-label="確認済み">
                    <Icon name="check" />
                  </span>
                ) : (
                  <span className="group__value muted">未確認</span>
                )}
              </div>
            ))}
          </Group>

          <Group
            header="提出"
            footer={
              doc.skip_reason ? (
                <span className="warn">
                  確認がそろわないまま提出：{doc.skip_reason}
                </span>
              ) : submitted ? undefined : (
                "学会などへの提出は自分で行います。提出後、受領メールを添えてここに記録してください。"
              )
            }
          >
            {submitted ? (
              <>
                <div className="group__row">
                  <span className="group__label">提出日</span>
                  <span className="group__value">
                    {formatShort(doc.submitted_at!.slice(0, 10))}（v
                    {submittedVersion?.number ?? "?"}）
                  </span>
                </div>
                {doc.receipt_name && (
                  <a
                    className="group__row group__link"
                    href={api.receiptUrl(doc.id)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <span className="group__label">受領メール</span>
                    <span className="group__value muted">
                      {doc.receipt_name}
                    </span>
                    <span className="group__chevron">
                      <Icon name="chevronRight" />
                    </span>
                  </a>
                )}
                <button
                  className="group__row group__action group__action--danger"
                  onClick={undoSubmission}
                >
                  提出を取り消す
                </button>
              </>
            ) : (
              <button
                className="group__row group__action"
                onClick={() => setSubmitting(true)}
                disabled={!versions.length}
              >
                提出を報告…
              </button>
            )}
          </Group>

          {submitted && (
            <Group
              header="業績"
              footer="HP の業績リストと、修論・卒論の研究業績（.bib）に使います。"
            >
              <LineField
                key={`published_month:${doc.published_month ?? ""}`}
                label="発表年月"
                type="month"
                value={doc.published_month}
                onSave={(v) => save({ published_month: v || null })}
              />
              <LineField
                key={`volume:${doc.volume ?? ""}`}
                label="巻"
                value={doc.volume}
                placeholder="Vol."
                onSave={(v) => save({ volume: v })}
              />
              <LineField
                key={`number:${doc.number ?? ""}`}
                label="号"
                value={doc.number}
                placeholder="No."
                onSave={(v) => save({ number: v })}
              />
              <LineField
                key={`pages:${doc.pages ?? ""}`}
                label="ページ"
                value={doc.pages}
                placeholder="12-16"
                onSave={(v) => save({ pages: v })}
              />
              <LineField
                key={`paper_no:${doc.paper_no ?? ""}`}
                label="講演番号"
                value={doc.paper_no}
                placeholder="G-37"
                onSave={(v) => save({ paper_no: v })}
              />
              <label className="group__row">
                <span className="group__label">不採録</span>
                <input
                  className="switch"
                  type="checkbox"
                  role="switch"
                  checked={Boolean(doc.rejected)}
                  onChange={(e) => save({ rejected: e.target.checked ? 1 : 0 })}
                />
              </label>
            </Group>
          )}
        </>
      )}
      <Group>
        {doc.slack_url && (
          <a
            className="group__row group__link"
            href={doc.slack_url}
            target="_blank"
            rel="noreferrer"
          >
            <span className="group__label group__label--text">
              Slackのスレッド
            </span>
            <span className="group__chevron">
              <Icon name="chevronRight" />
            </span>
          </a>
        )}
        <button
          className="group__row group__action group__action--danger"
          onClick={remove}
        >
          {slides ? "スライドを削除" : "原稿を削除"}
        </button>
      </Group>

      {!slides && submitting && (
        <SubmitDialog
          detail={detail}
          requireAuthor={requireAuthor}
          onClose={() => setSubmitting(false)}
          onDone={async () => {
            setSubmitting(false);
            await onChanged();
            onToast("提出を記録しました");
          }}
          onToast={onToast}
        />
      )}
    </div>
  );
}

/** 白い欄のまとまり。上に小さな見出し、下に補足 */
function Group({
  header,
  footer,
  children,
}: {
  header?: string;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="group">
      {header && <h3 className="group__header">{header}</h3>}
      <div className="group__body">{children}</div>
      {footer && (
        <p className="group__footer">
          {typeof footer === "string" ? <Jp>{footer}</Jp> : footer}
        </p>
      )}
    </section>
  );
}

/** 変えたら、欄を離れたときに保存する1行の入力。項目名は左、値は右 */
function LineField({
  label,
  value,
  placeholder,
  type = "text",
  onSave,
}: {
  label: string;
  value: string | null;
  placeholder?: string;
  type?: string;
  onSave(v: string): void;
}) {
  // 保存した値が変わったら、呼ぶ側が key を変えて作り直す（入れかけの文字を上書きしないように、ここでは合わせない）
  const [draft, setDraft] = useState(value ?? "");
  return (
    <label className="group__row">
      <span className="group__label">{label}</span>
      <input
        className="group__input"
        type={type}
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => draft.trim() !== (value ?? "") && onSave(draft.trim())}
        onKeyDown={(e) =>
          e.key === "Enter" &&
          !e.nativeEvent.isComposing &&
          e.currentTarget.blur()
        }
      />
    </label>
  );
}

/** 提出の報告。受領メールを添える。確認がそろっていなければ理由も書く */
function SubmitDialog({
  detail,
  requireAuthor,
  onClose,
  onDone,
  onToast,
}: {
  detail: DocumentDetail;
  requireAuthor(): Promise<string | null>;
  onClose(): void;
  onDone(): Promise<void>;
  onToast(m: string): void;
}) {
  const { document: doc, review, versions } = detail;
  const ref = useRef<HTMLDialogElement>(null);
  const [receipt, setReceipt] = useState<File | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const allOk = !review.waiting.length;
  useEffect(() => ref.current?.showModal(), []);

  async function submit() {
    const name = await requireAuthor();
    if (!name || !receipt) return;
    setBusy(true);
    try {
      await api.submit(doc.id, {
        author: name,
        receipt,
        reason: allOk ? undefined : reason,
      });
      await onDone();
    } catch (e) {
      onToast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog ref={ref} className="dialog" onClose={onClose}>
      <h2>提出を報告</h2>
      <p>
        <Jp>
          {`v${versions.at(-1)?.number}${doc.venue ? ` を${doc.venue}に` : " を"}提出したら、受領メールを添えてください。`}
        </Jp>
      </p>
      <div className="stack">
        <input
          type="file"
          onChange={(e) => setReceipt(e.target.files?.[0] ?? null)}
          aria-label="受領メール"
        />
        {!allOk && (
          <>
            <p className="warn warn--block">
              未確認の人がいます：
              {review.people
                .filter((p) => !p.ok)
                .map((p) => p.name)
                .join("、")}
            </p>
            <textarea
              className="field"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="確認がそろわないまま提出する理由（スレッドに残ります）"
              aria-label="理由"
            />
          </>
        )}
      </div>
      <div className="dialog__actions">
        <button className="btn" onClick={() => ref.current?.close()}>
          キャンセル
        </button>
        <button
          className="btn btn--primary"
          onClick={submit}
          disabled={busy || !receipt || (!allOk && !reason.trim())}
        >
          {busy ? "送信中…" : "報告"}
        </button>
      </div>
    </dialog>
  );
}

function TitleEditor({
  initial,
  canReset,
  onSubmit,
  onCancel,
}: {
  initial: string;
  canReset: boolean;
  onSubmit(title: string): void;
  onCancel(): void;
}) {
  const [title, setTitle] = useState(initial);
  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        if (title.trim()) onSubmit(title.trim());
      }}
    >
      <textarea
        className="field"
        rows={2}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        autoFocus
        aria-label="題名"
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            if (title.trim()) onSubmit(title.trim());
          }
          if (e.key === "Escape") onCancel();
        }}
      />
      <div className="composer__row">
        {canReset && (
          <button
            type="button"
            className="link-btn composer__note"
            onClick={() => onSubmit("")}
          >
            PDFの題名に戻す
          </button>
        )}
        <button type="button" className="btn" onClick={onCancel}>
          キャンセル
        </button>
        <button
          type="submit"
          className="btn btn--primary"
          disabled={!title.trim()}
        >
          保存
        </button>
      </div>
    </form>
  );
}
