"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useToast } from "@/app/components/Toast";
import { api, type Person } from "@/app/lib/client/api";
import { Icon } from "@/app/components/Icon";
import { Jp } from "@/app/components/Jp";

/**
 * メンバーの一覧。人は PDF の著者や Slack から自動で増える。
 * ここで直すのはローマ字の名前だけ（HP の英語の業績と .bib に使う）。
 */
export function People() {
  const [people, setPeople] = useState<Person[] | null>(null);
  const [toast, showToast] = useToast();

  useEffect(() => {
    api.people().then(setPeople, (e: Error) => showToast(e.message));
  }, [showToast]);

  async function saveEn(p: Person, value: string) {
    if (value === (p.name_en ?? p.name_en_guess ?? "")) return;
    try {
      await api.setNameEn(p.id, value);
      setPeople(
        (list) =>
          list?.map((x) =>
            x.id === p.id ? { ...x, name_en: value || null } : x,
          ) ?? null,
      );
      showToast(`${p.name}さんのローマ字を保存しました`);
    } catch (e) {
      showToast((e as Error).message);
    }
  }

  return (
    <div className="home home--narrow">
      <header className="topbar">
        <Link className="topbar__back" href="/" aria-label="原稿の一覧に戻る">
          <Icon name="chevronLeft" />
          一覧
        </Link>
        <span className="topbar__brand">メンバー</span>
      </header>
      <main className="home__inner home__inner--narrow">
        <h1 className="visually-hidden">メンバー</h1>
        <p className="info__note people__lead">
          <Jp>
            {
              "PDF の著者や Slack から自動で追加されます。\nローマ字は、HP の英語の業績リストと修論の研究業績（.bib）に使います。"
            }
          </Jp>
        </p>
        <section className="card" aria-label="メンバーの一覧">
          {people === null ? (
            <p className="empty">読み込み中…</p>
          ) : people.length === 0 ? (
            <p className="empty">
              <Jp>
                {"メンバーはいません。\nSlack で PDF を送ると追加されます。"}
              </Jp>
            </p>
          ) : (
            <ul className="people">
              {people.map((p) => (
                <li key={p.id} className="people__row">
                  <div className="people__main">
                    <span className="people__name">{p.name}</span>
                    <span className="muted">
                      原稿 {p.papers}本
                      {p.slack_user_id ? " ・ Slack とつながっています" : ""}
                    </span>
                  </div>
                  <input
                    className="field field--line people__en"
                    defaultValue={p.name_en ?? p.name_en_guess ?? ""}
                    placeholder="ローマ字"
                    aria-label={`${p.name}さんのローマ字`}
                    onBlur={(e) => saveEn(p, e.target.value.trim())}
                    onKeyDown={(e) =>
                      e.key === "Enter" &&
                      !e.nativeEvent.isComposing &&
                      e.currentTarget.blur()
                    }
                  />
                  {p.papers > 0 && (
                    <a className="link-btn" href={api.bibUrl(p.id)}>
                      .bib
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
      {toast}
    </div>
  );
}
