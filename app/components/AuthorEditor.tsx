"use client";

import { useEffect, useId, useState } from "react";
import { nameKeys } from "@/app/lib/names";
import { api, type Author } from "@/app/lib/client/api";
import { Icon } from "@/app/components/Icon";

/**
 * 著者を並びの順に直す。知っている人は一覧から選び、知らない名前は新しい人として登録する。
 * PDF の1ページ目を横に出して、見ながら入れられるようにする。
 */
export function AuthorEditor({
  authors,
  header,
  onSave,
  onCancel,
}: {
  authors: Author[];
  header: string | null;
  onSave(list: ({ id: string } | { name: string })[]): void;
  onCancel(): void;
}) {
  const [list, setList] = useState<
    { key: string; id?: string; name: string }[]
  >(authors.map((a) => ({ key: a.id, id: a.id, name: a.name })));
  const [people, setPeople] = useState<(Author & { keys: string[] })[]>([]);
  const [draft, setDraft] = useState("");
  const listId = useId();

  useEffect(() => {
    api.people().then(setPeople, () => {});
  }, []);

  function add() {
    const name = draft.trim();
    if (!name) return;
    // 空白・姓名の順・ローマ字などの書き方の違いは、同じ人とみなす（サーバーと同じ照合）
    const keys = nameKeys(name);
    const known = people.find((p) => p.keys.some((k) => keys.includes(k)));
    if (!list.some((a) => (known ? a.id === known.id : a.name === name))) {
      setList((l) => [
        ...l,
        { key: `${Date.now()}`, id: known?.id, name: known?.name ?? name },
      ]);
    }
    setDraft("");
  }

  const move = (i: number, by: number) =>
    setList((l) => {
      const next = [...l];
      const [item] = next.splice(i, 1);
      next.splice(i + by, 0, item);
      return next;
    });

  return (
    <div className="stack">
      {list.length > 0 && (
        <ol className="author-edit">
          {list.map((a, i) => (
            <li key={a.key}>
              <span className="author-edit__no">{i + 1}</span>
              <span className="author-edit__name">
                {a.name}
                {!a.id && <span className="muted">（新規）</span>}
              </span>
              <button
                className="btn btn--icon btn--small"
                onClick={() => move(i, -1)}
                disabled={i === 0}
                aria-label={`${a.name} を前へ`}
              >
                <Icon name="chevronUp" />
              </button>
              <button
                className="btn btn--icon btn--small"
                onClick={() => move(i, 1)}
                disabled={i === list.length - 1}
                aria-label={`${a.name} を後ろへ`}
              >
                <Icon name="chevronDown" />
              </button>
              <button
                className="btn btn--icon btn--small"
                onClick={() => setList((l) => l.filter((x) => x !== a))}
                aria-label={`${a.name} を外す`}
              >
                <Icon name="xmark" />
              </button>
            </li>
          ))}
        </ol>
      )}
      <form
        className="author-edit__add"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <input
          className="field field--line"
          list={listId}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // 候補の一覧（datalist）が開いていると、Enter で送信されないことがある
            if (e.key === "Enter" && !e.nativeEvent.isComposing) {
              e.preventDefault();
              add();
            }
          }}
          placeholder="名前"
          aria-label="著者を追加"
        />
        <datalist id={listId}>
          {people.map((p) => (
            <option key={p.id} value={p.name} />
          ))}
        </datalist>
        <button type="submit" className="btn" disabled={!draft.trim()}>
          追加
        </button>
      </form>
      {header && (
        <details className="author-edit__header">
          <summary>PDFの1ページ目を見る</summary>
          <pre>{header}</pre>
        </details>
      )}
      <div className="composer__row">
        <button className="btn" onClick={onCancel}>
          キャンセル
        </button>
        <button
          className="btn btn--primary"
          onClick={() => {
            // 入れかけの名前も、追加してから保存する
            const pending =
              draft.trim() && !list.some((a) => a.name === draft.trim())
                ? [{ name: draft.trim() }]
                : [];
            onSave([
              ...list.map((a) => (a.id ? { id: a.id } : { name: a.name })),
              ...pending,
            ]);
          }}
        >
          保存
        </button>
      </div>
    </div>
  );
}
