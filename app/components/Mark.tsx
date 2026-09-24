"use client";

import {
  useHighlightContainerContext,
  type Highlight,
} from "react-pdf-highlighter-plus";
import type { Status } from "@/app/lib/client/api";

/** PDF に重ねるしるし。コメントの状態と選択状態を highlight に持たせて渡す。 */
export type ReviewHighlight = Highlight & {
  status?: Status;
  active?: boolean;
  onSelect?(id: string): void;
};

// ハイライト層は PDF のページごとに別の React ルートで描かれるため、
// React の Context は届かない。必要な情報はすべて highlight 自体に載せる。
export function Mark() {
  const { highlight, isScrolledTo } =
    useHighlightContainerContext<ReviewHighlight>();
  const isArea = highlight.type === "area";
  const pending = !highlight.onSelect; // 保存前の選択（ゴースト）には id もコールバックも無い
  const rects =
    isArea || highlight.position.rects.length === 0
      ? [highlight.position.boundingRect]
      : highlight.position.rects;

  const className = [
    "mark",
    isArea ? "mark--area" : "mark--text",
    pending && "mark--pending",
    highlight.status && highlight.status !== "open" && "mark--done",
    (highlight.active || isScrolledTo) && "mark--active",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={className}
      onClick={() => highlight.onSelect?.(highlight.id)}
    >
      {rects.map((r, i) => (
        <div
          key={i}
          className="mark__part"
          style={{ left: r.left, top: r.top, width: r.width, height: r.height }}
        />
      ))}
    </div>
  );
}
