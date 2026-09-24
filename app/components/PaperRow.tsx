"use client";

import Link from "next/link";
import type { Author, PaperSummary } from "@/app/lib/client/api";
import { daysLeft, formatShort } from "@/app/lib/client/papers";

/** 締切。近いものは色を付ける。提出したあとは色を付けない */
function Deadline({ date, done }: { date: string; done: boolean }) {
  const left = daysLeft(date);
  const tone = done
    ? ""
    : left < 0
      ? "deadline--over"
      : left <= 7
        ? "deadline--soon"
        : "";
  return <span className={`deadline ${tone}`}>{formatShort(date)}</span>;
}

/** 原稿の一覧の1枚。カードを押すと原稿が開き、著者の名前を押すとその人の原稿に絞り込む */
export function PaperRow({
  paper: p,
  onAuthor,
}: {
  paper: PaperSummary;
  onAuthor(author: Author): void;
}) {
  return (
    <li className="paper-card">
      <Link className="paper-card__title" href={`/d/${p.id}`}>
        {p.title}
      </Link>
      <p className="paper-card__authors">
        {p.authors.length ? (
          p.authors.map((a, i) => (
            <span key={a.id}>
              {i > 0 && ", "}
              <button
                className="paper-card__author"
                onClick={() => onAuthor(a)}
                title={`${a.name} の原稿だけを見る`}
              >
                {a.name}
              </button>
            </span>
          ))
        ) : (
          <span className="muted">著者未設定</span>
        )}
      </p>
      {p.stage !== "slides" && (p.venue || p.deadline) && (
        <p className="paper-card__meta">
          {p.venue && <span className="paper-card__venue">{p.venue}</span>}
          {p.venue && p.deadline && " · "}
          {p.deadline && (
            <Deadline date={p.deadline} done={Boolean(p.submitted_at)} />
          )}
        </p>
      )}
    </li>
  );
}
