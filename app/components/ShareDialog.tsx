"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/app/lib/client/api";
import { askConfirm } from "@/app/components/Confirm";
import { Jp } from "@/app/components/Jp";

/** 研究室用のリンクを見せる。Notion などに貼ってもらう */
export function ShareDialog({
  onClose,
  onToast,
}: {
  onClose(): void;
  onToast(m: string): void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [url, setUrl] = useState("");

  useEffect(() => {
    ref.current?.showModal();
    api.access().then(
      (r) => setUrl(r.url),
      (e: Error) => onToast(e.message),
    );
  }, [onToast]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      onToast("リンクをコピーしました");
    } catch {
      onToast("コピーできませんでした。\nリンクを選んでコピーしてください");
    }
  }

  async function rotate() {
    const yes = await askConfirm(
      "リンクを再発行しますか？\n今のリンクは、Slack や Notion に貼ったものも含めて使えなくなります。\nほかの人も、新しいリンクから開き直すことになります。",
      { ok: "再発行", danger: true },
    );
    if (!yes) return;
    try {
      setUrl((await api.rotateAccess()).url);
      onToast("リンクを再発行しました。\n貼ってある場所を差し替えてください");
    } catch (e) {
      onToast((e as Error).message);
    }
  }

  return (
    <dialog ref={ref} className="dialog" onClose={onClose}>
      <h2>研究室用のリンク</h2>
      <p>
        <Jp>
          {
            "このリンクを知っている人だけが開けます。\nNotion やゼミの管理アプリ、ブックマークに貼ってください。\n研究室の外には貼らないでください。"
          }
        </Jp>
      </p>
      <input
        className="field field--line share__url"
        readOnly
        value={url}
        onFocus={(e) => e.currentTarget.select()}
        aria-label="研究室用のリンク"
      />
      <div className="dialog__actions dialog__actions--split">
        <button className="link-btn menu__danger" onClick={rotate}>
          リンクを再発行
        </button>
        <span className="dialog__spacer" />
        <button className="btn" onClick={() => ref.current?.close()}>
          閉じる
        </button>
        <button className="btn btn--primary" onClick={copy} disabled={!url}>
          コピー
        </button>
      </div>
    </dialog>
  );
}
