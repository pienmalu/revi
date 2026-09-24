"use client";

import {
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from "react";

/** Only the handle captures gestures; comments and form fields keep native scrolling. */
export function useBottomSheet(open: boolean, onToggle: () => void) {
  const panelRef = useRef<HTMLElement>(null);
  const gesture = useRef<{
    id: number;
    y: number;
    height: number;
    min: number;
    middle: number;
    max: number;
    moved: boolean;
  } | null>(null);
  const suppressClick = useRef(false);
  const [expanded, setExpanded] = useState(false);
  const [dragHeight, setDragHeight] = useState<number | null>(null);

  function onPointerDown(event: PointerEvent<HTMLButtonElement>) {
    if (
      !event.isPrimary ||
      event.button !== 0 ||
      !window.matchMedia("(max-width: 899px)").matches
    )
      return;
    const panel = panelRef.current;
    if (!panel) return;
    suppressClick.current = false;
    const rect = panel.getBoundingClientRect();
    // Read the CSS viewport size, including Safari's changing browser bars.
    const style = getComputedStyle(panel);
    const max = Number.parseFloat(style.maxHeight);
    const min = Number.parseFloat(style.minHeight);
    gesture.current = {
      id: event.pointerId,
      y: event.clientY,
      height: rect.height,
      min,
      middle: Math.min((max + 12) * 0.72, 640, max),
      max,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: PointerEvent<HTMLButtonElement>) {
    const drag = gesture.current;
    if (!drag || drag.id !== event.pointerId) return;
    const delta = drag.y - event.clientY;
    if (!drag.moved && Math.abs(delta) < 6) return;
    drag.moved = true;
    suppressClick.current = true;
    setDragHeight(Math.max(drag.min, Math.min(drag.max, drag.height + delta)));
  }

  function finish(event: PointerEvent<HTMLButtonElement>, cancelled = false) {
    const drag = gesture.current;
    if (!drag || drag.id !== event.pointerId) return;
    gesture.current = null;
    setDragHeight(null);
    if (cancelled || !drag.moved) return;
    const height = Math.max(
      drag.min,
      Math.min(drag.max, drag.height + drag.y - event.clientY),
    );
    const stops = [drag.min, drag.middle, drag.max];
    const closest = stops.reduce((best, stop) =>
      Math.abs(height - stop) < Math.abs(height - best) ? stop : best,
    );
    const nextOpen = closest !== drag.min;
    setExpanded(closest === drag.max);
    if (nextOpen !== open) onToggle();
  }

  return {
    panelRef,
    className: `${open || dragHeight !== null ? " panel--open" : ""}${expanded ? " panel--full" : ""}${dragHeight !== null ? " panel--dragging" : ""}`,
    style:
      dragHeight === null
        ? undefined
        : ({ "--sheet-height": `${dragHeight}px` } as CSSProperties),
    handle: {
      onPointerDown,
      onPointerMove,
      onPointerUp: (event: PointerEvent<HTMLButtonElement>) => finish(event),
      onPointerCancel: (event: PointerEvent<HTMLButtonElement>) =>
        finish(event, true),
      onLostPointerCapture: (event: PointerEvent<HTMLButtonElement>) =>
        finish(event, true),
      onClick: () => {
        if (suppressClick.current) {
          suppressClick.current = false;
          return;
        }
        setExpanded(false);
        onToggle();
      },
      onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => {
        suppressClick.current = false;
        if (event.key === "ArrowUp") {
          event.preventDefault();
          setExpanded(open);
          if (!open) onToggle();
        } else if (event.key === "ArrowDown" || event.key === "Escape") {
          event.preventDefault();
          if (expanded && event.key !== "Escape") setExpanded(false);
          else if (open) onToggle();
        }
      },
    },
  };
}
