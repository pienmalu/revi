"use client";

import {
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from "react";
import {
  PdfHighlighter,
  PdfLoader,
  type PdfHighlighterUtils,
  type PdfScaleValue,
  type PdfSelection,
  type ScaledPosition,
} from "react-pdf-highlighter-plus";
import { AreaOverlay } from "./AreaOverlay";
import { Mark, type ReviewHighlight } from "./Mark";
import { Icon } from "./Icon";
import { Jp } from "./Jp";
import { api, type Comment } from "../lib/client/api";
import type { Pending } from "./CommentPanel";

export type PdfWorkspaceHandle = {
  clearSelection(): void;
  selectComment(comment: Comment): void;
};

const ZOOM_STEP = 1.2;

/** PDFの操作を閉じ込め、版の操作とコメント欄を画面から受け取る。 */
export function PdfWorkspace({
  versionId,
  comments,
  pending,
  activeId,
  onPending,
  onSelect,
  toolbar,
  notice,
  children,
  ref,
}: {
  versionId?: string;
  comments: Comment[];
  pending: Pending | null;
  activeId: string | null;
  onPending(pending: Pending | null): void;
  onSelect(id: string): void;
  toolbar: ReactNode;
  notice: ReactNode;
  children: ReactNode;
  ref: Ref<PdfWorkspaceHandle>;
}) {
  const utils = useRef<PdfHighlighterUtils | null>(null);
  const [areaMode, setAreaMode] = useState(false);
  const [scale, setScale] = useState<PdfScaleValue>("page-width");
  const [zoom, setZoom] = useState<number | null>(null);
  const pdfSource = usePdfSource(versionId);
  const highlights = useMemo<ReviewHighlight[]>(
    () =>
      comments
        .filter((c) => c.position)
        .map<ReviewHighlight>((c) => ({
          id: c.id,
          type: c.kind === "area" ? "area" : "text",
          position: c.position!,
          content: { text: c.quote ?? undefined },
          status: c.status,
          active: c.id === activeId,
          onSelect: onSelect,
        }))
        // 自前の四角選択で作った保存前の範囲は、PDF 部品のゴーストが無いのでここで描く
        .concat(
          pending && !pending.ghost
            ? [{ id: "pending", type: "area", position: pending.position }]
            : [],
        ),
    [comments, activeId, onSelect, pending],
  );

  // タッチ端末では長押しで選んだ後に pointerup が来ないため、選択が落ち着いたら確定の合図を送る
  useEffect(() => {
    if (!window.matchMedia("(pointer: coarse)").matches) return;
    let timer: number | undefined;
    const onChange = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const sel = document.getSelection();
        const container = document.querySelector(".stage .PdfHighlighter");
        if (
          !sel ||
          sel.isCollapsed ||
          !container ||
          !container.contains(sel.anchorNode)
        )
          return;
        container.dispatchEvent(
          new PointerEvent("pointerup", { bubbles: true }),
        );
      }, 700);
    };
    document.addEventListener("selectionchange", onChange);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("selectionchange", onChange);
    };
  }, []);

  function handleSelection(selection: PdfSelection) {
    const ghost = selection.makeGhostHighlight();
    onPending({
      kind: ghost.type === "area" ? "area" : "text",
      quote: ghost.content.text?.trim() || undefined,
      position: ghost.position,
      ghost: true,
    });
  }

  function handleArea(position: ScaledPosition) {
    utils.current?.removeGhostHighlight();
    onPending({ kind: "area", position, ghost: false });
  }

  function zoomBy(factor: number) {
    const current = zoom ?? utils.current?.getViewer()?.currentScale ?? 1;
    const next = Math.min(4, Math.max(0.4, current * factor));
    setScale(next);
    setZoom(next);
  }

  useImperativeHandle(
    ref,
    () => ({
      clearSelection() {
        utils.current?.removeGhostHighlight();
        window.getSelection()?.removeAllRanges();
      },
      selectComment(comment) {
        const highlight = highlights.find((h) => h.id === comment.id);
        if (highlight) utils.current?.scrollToHighlight(highlight);
      },
    }),
    [highlights],
  );

  return (
    <>
      <div className="toolbar">
        {toolbar}
        <div className="toolbar__spacer" />
        <div className="segmented" role="group" aria-label="選び方">
          <button aria-pressed={!areaMode} onClick={() => setAreaMode(false)}>
            文字
          </button>
          <button aria-pressed={areaMode} onClick={() => setAreaMode(true)}>
            範囲
          </button>
        </div>
        {/* 倍率は − と ＋ で倍率の表示をはさむ。表示を押すと幅に戻す */}
        <div className="zoom" role="group" aria-label="倍率">
          <button onClick={() => zoomBy(1 / ZOOM_STEP)} aria-label="縮小">
            <Icon name="minus" />
          </button>
          <button
            className="zoom__label"
            onClick={() => {
              setScale("page-width");
              setZoom(null);
            }}
            title="幅に合わせる"
          >
            {zoom ? `${Math.round(zoom * 100)}%` : "幅"}
          </button>
          <button onClick={() => zoomBy(ZOOM_STEP)} aria-label="拡大">
            <Icon name="plus" />
          </button>
        </div>
      </div>
      {notice}
      <div className="review__body">
        <main className="stage">
          {pdfSource && (
            <PdfLoader
              key={versionId}
              document={pdfSource}
              workerSrc="/pdfjs/pdf.worker.min.mjs"
              beforeLoad={() => (
                <p className="stage__message">PDFを読み込んでいます…</p>
              )}
              errorMessage={(e) => (
                <p className="stage__message">
                  {e.name === "PasswordException" ? (
                    <Jp>
                      {
                        "パスワード付きのPDFは開けません。\nパスワードを外したPDFを送ってください。"
                      }
                    </Jp>
                  ) : (
                    `PDFを開けませんでした：${e.message}`
                  )}
                </p>
              )}
            >
              {(pdfDocument) => (
                <PdfHighlighter
                  pdfDocument={pdfDocument}
                  highlights={highlights}
                  pdfScaleValue={scale}
                  onZoomChange={setZoom}
                  onSelection={handleSelection}
                  onRemoveGhostHighlight={() => onPending(null)}
                  enableAreaSelection={(e) => e.altKey}
                  textSelectionColor="var(--mark-active)"
                  utilsRef={(u) => (utils.current = u)}
                  style={{ height: "100%" }}
                >
                  <Mark />
                </PdfHighlighter>
              )}
            </PdfLoader>
          )}
          {areaMode && (
            <AreaOverlay utils={() => utils.current} onArea={handleArea} />
          )}
        </main>
        {children}
      </div>
    </>
  );
}

/** PDFの入力は版IDが変わったときだけ作り直す。 */
function usePdfSource(versionId: string | undefined) {
  return useMemo(
    () =>
      versionId && {
        url: api.pdfUrl(versionId),
        // 日本語フォントの描画に必要（無いと和文だけが消える）
        cMapUrl: "/pdfjs/cmaps/",
        cMapPacked: true,
        standardFontDataUrl: "/pdfjs/standard_fonts/",
      },
    [versionId],
  );
}
