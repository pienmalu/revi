"use client";

import {
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  viewportPositionToScaled,
  type PdfHighlighterUtils,
  type ScaledPosition,
} from "react-pdf-highlighter-plus";

type Props = {
  utils: () => PdfHighlighterUtils | null;
  onArea(position: ScaledPosition): void;
};

type Drag = {
  page: HTMLElement;
  pageNumber: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** ドラッグを始めたときの板の位置（描いている四角の基準） */
  origin: { left: number; top: number };
};

const MIN_SIZE = 8;

/**
 * 「範囲」モードで PDF の上に重ねる透明な板。マウスでも指でも四角を描ける。
 * （PDF 部品の四角選択はマウス操作にしか反応しないため、自前で用意している）
 */
export function AreaOverlay({ utils, onArea }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  // 描画用の state と、描画を待たずに読める ref の両方に持つ（速いドラッグでも取りこぼさない）
  const dragRef = useRef<Drag | null>(null);
  const [drag, setDragState] = useState<Drag | null>(null);
  const setDrag = (d: Drag | null) => {
    dragRef.current = d;
    setDragState(d);
  };

  // ページの中身（枠線の内側）を基準にした座標の範囲
  const pageBox = (page: HTMLElement) => {
    const r = page.getBoundingClientRect();
    const left = r.left + page.clientLeft;
    const top = r.top + page.clientTop;
    return {
      left,
      top,
      right: left + page.clientWidth,
      bottom: top + page.clientHeight,
    };
  };

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    const page = document
      .elementsFromPoint(e.clientX, e.clientY)
      .find(
        (el): el is HTMLElement =>
          el instanceof HTMLElement && el.classList.contains("page"),
      );
    const pageNumber = Number(page?.dataset.pageNumber);
    if (!page || !pageNumber) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const { left, top } = e.currentTarget.getBoundingClientRect();
    setDrag({
      page,
      pageNumber,
      origin: { left, top },
      x0: e.clientX,
      y0: e.clientY,
      x1: e.clientX,
      y1: e.clientY,
    });
  }

  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    const box = pageBox(drag.page);
    setDrag({
      ...drag,
      x1: Math.min(box.right, Math.max(box.left, e.clientX)),
      y1: Math.min(box.bottom, Math.max(box.top, e.clientY)),
    });
  }

  function onPointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    const viewer = utils()?.getViewer();
    const drag = dragRef.current;
    if (!drag) return;
    setDrag(null);
    const width = Math.abs(drag.x1 - drag.x0);
    const height = Math.abs(drag.y1 - drag.y0);
    if (width < MIN_SIZE && height < MIN_SIZE) {
      // ただのクリックなら、下にある既存のしるしを選べるようにする
      for (const el of document.elementsFromPoint(e.clientX, e.clientY)) {
        const mark = el.closest<HTMLElement>(".mark");
        if (mark) return mark.click();
      }
      return;
    }
    if (!viewer || width < MIN_SIZE || height < MIN_SIZE) return;
    const box = pageBox(drag.page);
    const boundingRect = {
      left: Math.min(drag.x0, drag.x1) - box.left,
      top: Math.min(drag.y0, drag.y1) - box.top,
      width,
      height,
      pageNumber: drag.pageNumber,
    };
    onArea(viewportPositionToScaled({ boundingRect, rects: [] }, viewer));
  }

  return (
    <div
      ref={ref}
      className="area-overlay"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => setDrag(null)}
      // 板の上でもホイールでスクロールできるようにする
      onWheel={(e) =>
        document
          .querySelector(".stage .PdfHighlighter")
          ?.scrollBy({ top: e.deltaY, left: e.deltaX })
      }
    >
      {drag && (
        <div
          className="area-overlay__draft"
          style={{
            left: Math.min(drag.x0, drag.x1) - drag.origin.left,
            top: Math.min(drag.y0, drag.y1) - drag.origin.top,
            width: Math.abs(drag.x1 - drag.x0),
            height: Math.abs(drag.y1 - drag.y0),
          }}
        />
      )}
    </div>
  );
}
