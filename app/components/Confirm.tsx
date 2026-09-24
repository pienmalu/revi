"use client";

import { useEffect, useRef, useState } from "react";
import { Jp } from "@/app/components/Jp";

// ブラウザの confirm() は、Slack やアプリの中のブラウザでは表示されずに「キャンセル」になることがある。
// そのため、確認はアプリ自身のダイアログで聞く。

type Request = {
  message: string;
  ok: string;
  danger: boolean;
  resolve(answer: boolean): void;
};

let show: ((r: Request) => void) | null = null;

/** 確認を聞く。「キャンセル」や Esc なら false */
export function askConfirm(
  message: string,
  options: { ok?: string; danger?: boolean } = {},
) {
  return new Promise<boolean>((resolve) => {
    if (!show) return resolve(false);
    show({
      message,
      ok: options.ok ?? "OK",
      danger: options.danger ?? false,
      resolve,
    });
  });
}

/** 画面に1つだけ置く、確認のダイアログ */
export function ConfirmHost() {
  const [request, setRequest] = useState<Request | null>(null);
  const ref = useRef<HTMLDialogElement>(null);
  const answer = useRef(false);

  useEffect(() => {
    show = (r) => {
      answer.current = false;
      setRequest(r);
    };
    return () => {
      show = null;
    };
  }, []);

  useEffect(() => {
    if (request && !ref.current?.open) ref.current?.showModal();
  }, [request]);

  const close = (value: boolean) => {
    answer.current = value;
    ref.current?.close();
  };

  return (
    <dialog
      ref={ref}
      className="dialog dialog--alert"
      onClose={() => {
        request?.resolve(answer.current);
        setRequest(null);
      }}
    >
      {/* iPhone の確認と同じく、1行目を見出し、2行目からを説明にする */}
      <h2 className="confirm__title">
        <Jp>{request?.message.split("\n")[0] ?? ""}</Jp>
      </h2>
      {request?.message.includes("\n") && (
        <p className="confirm__message">
          <Jp>{request.message.split("\n").slice(1).join("\n")}</Jp>
        </p>
      )}
      <div className="dialog__actions">
        <button className="btn" onClick={() => close(false)}>
          キャンセル
        </button>
        <button
          className={`btn ${request?.danger ? "btn--danger" : "btn--primary"}`}
          onClick={() => close(true)}
        >
          {request?.ok}
        </button>
      </div>
    </dialog>
  );
}
