"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/app/lib/client/api";
import { Jp } from "@/app/components/Jp";

type Data = Awaited<ReturnType<typeof api.publications>>;

/** HP の業績リスト。提出した原稿（不採録を除く）から、HP と同じ形の文を作ってコピーできるようにする */
export function PublicationsDialog({
  onClose,
  onToast,
}: {
  onClose(): void;
  onToast(m: string): void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [year, setYear] = useState<number>();
  const [data, setData] = useState<Data>();

  useEffect(() => ref.current?.showModal(), []);
  useEffect(() => {
    api.publications(year).then(setData, (e: Error) => onToast(e.message));
  }, [year, onToast]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(data?.text ?? "");
      onToast("業績リストをコピーしました");
    } catch {
      onToast("コピーできませんでした。\n文を選んでコピーしてください");
    }
  }

  return (
    <dialog ref={ref} className="dialog dialog--wide" onClose={onClose}>
      <h2>HP の業績リスト</h2>
      <p>
        <Jp>
          {
            "提出した原稿（不採録を除く）から作ります。\n発表の年月が無い原稿は、締切の年月で数えます。"
          }
        </Jp>
      </p>
      <div className="inline-row">
        <select
          className="select"
          value={data?.year ?? ""}
          onChange={(e) => setYear(Number(e.target.value))}
          aria-label="年"
        >
          {(data?.years.length
            ? data.years
            : [data?.year ?? new Date().getFullYear()]
          ).map((y) => (
            <option key={y} value={y}>
              {y}年
            </option>
          ))}
        </select>
        <span className="muted">
          {data ? `${data.items.length}件` : "読み込み中…"}
        </span>
      </div>
      <textarea
        className="field publications__text"
        readOnly
        rows={12}
        value={data?.text || (data ? "この年の業績はありません。" : "")}
        aria-label="業績リスト"
        onFocus={(e) => e.currentTarget.select()}
      />
      {Boolean(data?.undated.length) && (
        <p className="info__note">
          年月が分からないため入っていない原稿：{data!.undated.join("、")}
        </p>
      )}
      <div className="dialog__actions">
        <button className="btn" onClick={() => ref.current?.close()}>
          閉じる
        </button>
        <button
          className="btn btn--primary"
          onClick={copy}
          disabled={!data?.text}
        >
          コピー
        </button>
      </div>
    </dialog>
  );
}
