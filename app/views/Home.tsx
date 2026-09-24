"use client";

import Link from "next/link";
import Image from "next/image";
import brandIcon from "@/app/icon.png";
import { useEffect, useMemo, useRef, useState } from "react";
import { useFlash, useNav, useQuery } from "@/app/lib/client/nav";
import { DropMenu } from "@/app/components/DropMenu";
import { PaperRow } from "@/app/components/PaperRow";
import { ShareDialog } from "@/app/components/ShareDialog";
import { useToast } from "@/app/components/Toast";
import { annotatedMessage, api, type PaperSummary } from "@/app/lib/client/api";
import { useAuthor } from "@/app/lib/client/author";
import { STAGE_LABEL, type Stage, yearOf } from "@/app/lib/client/papers";
import { PublicationsDialog } from "@/app/components/PublicationsDialog";
import { Icon } from "@/app/components/Icon";
import { Jp } from "@/app/components/Jp";

type Compare = (a: PaperSummary, b: PaperSummary) => number;

/**
 * 並び順（並べ替えはせず、いつも決まった順）：提出前を先に、締切の近い順（締切の無いものはその後ろ）。
 * 提出済は、提出した日の新しい順。同じなら最後に更新した順
 */
const byUpdated: Compare = (a, b) => b.updated_at.localeCompare(a.updated_at);
const order: Compare = (a, b) => {
  if (a.stage !== b.stage) {
    const order = { open: 0, submitted: 1, slides: 2 };
    return order[a.stage] - order[b.stage];
  }
  if (a.stage === "submitted")
    return (
      (b.submitted_at ?? "").localeCompare(a.submitted_at ?? "") ||
      byUpdated(a, b)
    );
  if (Boolean(a.deadline) !== Boolean(b.deadline)) return a.deadline ? -1 : 1;
  return (a.deadline ?? "").localeCompare(b.deadline ?? "") || byUpdated(a, b);
};

const searchable = (p: PaperSummary) =>
  [p.title, ...p.authors.map((a) => a.name), p.venue, p.created_by]
    .filter(Boolean)
    .join(" ")
    .normalize("NFKC")
    .toLowerCase();

export function Home() {
  const [papers, setPapers] = useState<PaperSummary[] | null>(null);
  const [params, set] = useQuery();
  const [author] = useAuthor();
  const [toast, showToast] = useToast();
  const [sharing, setSharing] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const navigate = useNav();

  // 原稿を削除して戻ってきたときなどの知らせ
  useFlash(showToast);

  useEffect(() => {
    api.documents().then(setPapers, (e: Error) => showToast(e.message));
  }, [showToast]);

  // 絞り込みは URL に持たせる（戻る・ブックマークでそのまま再現できる）
  const q = params.get("q") ?? "";
  const year = params.get("year") ?? "";
  const personId = params.get("person") ?? "";
  const stage = params.get("stage") ?? "";
  const [publishing, setPublishing] = useState(false);

  const years = useMemo(
    () => [...new Set((papers ?? []).map(yearOf))].sort((a, b) => b - a),
    [papers],
  );
  const person = useMemo(
    () => papers?.flatMap((p) => p.authors).find((a) => a.id === personId),
    [papers, personId],
  );

  const shown = useMemo(() => {
    const words = q
      .normalize("NFKC")
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    return (papers ?? [])
      .filter(
        (p) => !words.length || words.every((w) => searchable(p).includes(w)),
      )
      .filter((p) => !year || yearOf(p) === Number(year))
      .filter((p) => !stage || p.stage === stage)
      .filter((p) => !personId || p.authors.some((a) => a.id === personId))
      .sort(order);
  }, [papers, q, year, stage, personId]);

  async function upload(file: File) {
    try {
      const res = await api.upload(file, { author: author || undefined });
      const toast = res.duplicate
        ? `「${res.document.title}」の v${res.version.number} と同じファイルでした`
        : res.annotated
          ? annotatedMessage(res)
          : res.isNewDocument
            ? undefined
            : `「${res.document.title}」の v${res.version.number} として登録しました`;
      navigate(`/d/${res.document.id}?v=${res.version.number}`, { toast });
    } catch (e) {
      showToast((e as Error).message);
    }
  }

  async function exportShown(format: "csv" | "xlsx") {
    try {
      await api.exportPapers(
        shown.map((p) => p.id),
        format,
      );
    } catch (e) {
      showToast((e as Error).message);
    }
  }

  return (
    <div className="home">
      <header className="topbar">
        <span className="topbar__brand">
          <Image src={brandIcon} width={36} height={36} alt="" />
          れび
        </span>
        <div className="topbar__spacer" />
        <div className="topbar__actions">
          <Link className="link-btn link-btn--nav topbar__wide" href="/people">
            メンバー
          </Link>
          <button
            className="link-btn link-btn--nav topbar__wide"
            onClick={() => setSharing(true)}
          >
            研究室用リンク
          </button>
          {/* 狭い画面では、メンバーと研究室用リンクを「…」にまとめる */}
          <span className="topbar__narrow">
            <DropMenu
              className="icon-btn icon-btn--tool"
              label={<Icon name="ellipsis" />}
              ariaLabel="そのほか"
              items={[
                { label: "メンバー", onSelect: () => navigate("/people") },
                { label: "研究室用リンク", onSelect: () => setSharing(true) },
              ]}
            />
          </span>
          <button
            className="btn btn--primary"
            onClick={() => fileInput.current?.click()}
          >
            PDFを追加
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="application/pdf"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) upload(file);
            }}
          />
        </div>
      </header>
      <main className="home__inner">
        <h1 className="visually-hidden">原稿の一覧</h1>

        <div className="filters">
          <input
            className="field field--line filters__search"
            type="search"
            placeholder="題名・著者・提出先で探す"
            value={q}
            onChange={(e) => set({ q: e.target.value })}
            aria-label="検索"
          />
          <DropMenu
            className={`icon-btn icon-btn--tool ${year || stage ? "icon-btn--on" : ""}`}
            label={<Icon name="filter" />}
            ariaLabel="絞り込み"
            items={[
              { label: "年", heading: true },
              ...["", ...years.map(String)].map((y) => ({
                label: y ? `${y}年` : "すべての年",
                checked: year === y,
                onSelect: () => set({ year: y }),
              })),
              { label: "種類・状態", heading: true },
              ...(
                [["", "すべて"], ...Object.entries(STAGE_LABEL)] as [
                  string,
                  string,
                ][]
              ).map(([key, label]) => ({
                label,
                checked: stage === key,
                onSelect: () => set({ stage: key }),
              })),
            ]}
          />
          <DropMenu
            className="icon-btn icon-btn--tool"
            label={<Icon name="share" />}
            ariaLabel="共有"
            items={[
              { label: `表示中の${shown.length}本`, heading: true },
              { label: "Excel（.xlsx）", onSelect: () => exportShown("xlsx") },
              { label: "CSV（.csv）", onSelect: () => exportShown("csv") },
              { label: "HP の業績リスト", onSelect: () => setPublishing(true) },
              ...(person
                ? [
                    {
                      label: `${person.name}さんの研究業績（.bib）`,
                      onSelect: () =>
                        (window.location.href = api.bibUrl(person.id)),
                    },
                  ]
                : []),
            ]}
          />
        </div>

        {/* いま効いている絞り込み。押すと外れる */}
        {(personId || year || stage) && (
          <div className="filter-chips">
            {personId && (
              <button
                className="chip"
                onClick={() => set({ person: "" })}
                aria-label="著者の絞り込みを外す"
              >
                {person?.name ?? "不明"} <Icon name="xmark" />
              </button>
            )}
            {year && (
              <button
                className="chip"
                onClick={() => set({ year: "" })}
                aria-label="年の絞り込みを外す"
              >
                {year}年 <Icon name="xmark" />
              </button>
            )}
            {stage && (
              <button
                className="chip"
                onClick={() => set({ stage: "" })}
                aria-label="状態の絞り込みを外す"
              >
                {STAGE_LABEL[stage as Stage]} <Icon name="xmark" />
              </button>
            )}
          </div>
        )}

        {papers === null ? (
          <p className="empty">読み込み中…</p>
        ) : shown.length === 0 ? (
          <p className="empty">
            {papers.length === 0 ? (
              <Jp>
                {
                  "原稿はありません。\nSlack でボットをメンションして PDF を送るか、「PDFを追加」から始めてください。"
                }
              </Jp>
            ) : (
              "条件に合う原稿はありません。"
            )}
          </p>
        ) : (
          (Object.keys(STAGE_LABEL) as Stage[]).map((key) => {
            const group = shown.filter((p) => p.stage === key);
            if (!group.length) return null;
            return (
              <section
                key={key}
                className="paper-group"
                aria-labelledby={`group-${key}`}
              >
                <h2 id={`group-${key}`} className="paper-group__title">
                  {STAGE_LABEL[key]}
                </h2>
                <ul className="paper-list">
                  {group.map((p) => (
                    <PaperRow
                      key={p.id}
                      paper={p}
                      onAuthor={(a) => set({ person: a.id })}
                    />
                  ))}
                </ul>
              </section>
            );
          })
        )}
      </main>
      {sharing && (
        <ShareDialog onClose={() => setSharing(false)} onToast={showToast} />
      )}
      {publishing && (
        <PublicationsDialog
          onClose={() => setPublishing(false)}
          onToast={showToast}
        />
      )}
      {toast}
    </div>
  );
}
