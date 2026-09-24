"use client";

import { useEffect, useRef, useState } from "react";
import { Jp } from "@/app/components/Jp";

type Props = {
  open: boolean;
  initial: string;
  suggestions: string[];
  onSubmit(name: string): void;
  onClose(): void;
};

export function NameDialog({
  open,
  initial,
  suggestions,
  onSubmit,
  onClose,
}: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState(initial);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      setName(initial);
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open, initial]);

  return (
    <dialog ref={ref} className="dialog" onClose={onClose}>
      <form
        method="dialog"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) onSubmit(name.trim());
        }}
      >
        <h2>名前を入力してください</h2>
        <p>
          <Jp>
            {
              "コメントに表示されます。\nこのブラウザでは、最初に一度だけ入力します。"
            }
          </Jp>
        </p>
        {suggestions.length > 0 && (
          <div className="chips">
            {suggestions.map((s) => (
              <button
                key={s}
                type="button"
                className="btn"
                onClick={() => onSubmit(s)}
              >
                {s}
              </button>
            ))}
          </div>
        )}
        <label className="visually-hidden" htmlFor="author-name">
          名前
        </label>
        <input
          id="author-name"
          className="field field--line"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="例：片岡"
          autoFocus
        />
        <div className="dialog__actions">
          <button type="button" className="btn" onClick={onClose}>
            キャンセル
          </button>
          <button
            type="submit"
            className="btn btn--primary"
            disabled={!name.trim()}
          >
            完了
          </button>
        </div>
      </form>
    </dialog>
  );
}
