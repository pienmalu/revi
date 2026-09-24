type Viewer = {
  currentScale: number;
  currentScaleValue: string | null;
  container: HTMLDivElement;
};

type GestureEvent = Event & { scale: number; clientX: number; clientY: number };

/** 一本指のスクロール・文字選択を残し、二本指の間だけブラウザのスクロールを止める。 */
export function installTouchZoom(
  stage: HTMLElement,
  options: {
    viewer(): Viewer | null | undefined;
    onZoom(scale: number): void;
    onActive(active: boolean): void;
  },
) {
  let gesture: {
    viewer: Viewer;
    page: HTMLElement;
    scale: number;
    distance: number;
    originX: number;
    originY: number;
    anchorX: number;
    anchorY: number;
    ratio: number;
  } | null = null;
  let touches = 0;
  let frame = 0;
  let release = 0;

  function begin(x: number, y: number, distance: number) {
    const viewer = options.viewer();
    const page = viewer?.container.querySelector<HTMLElement>(".pdfViewer");
    if (!viewer || !page || viewer.currentScale <= 0) return;
    const rect = viewer.container.getBoundingClientRect();
    const anchorX = x - rect.left;
    const anchorY = y - rect.top;
    gesture = {
      viewer,
      page,
      scale: viewer.currentScale,
      distance,
      originX: viewer.container.scrollLeft + anchorX,
      originY: viewer.container.scrollTop + anchorY,
      anchorX,
      anchorY,
      ratio: 1,
    };
    window.clearTimeout(release);
    options.onActive(true);
    page.style.transformOrigin = `${gesture.originX}px ${gesture.originY}px`;
    page.style.willChange = "transform";
  }

  function preview(ratio: number) {
    if (!gesture) return;
    gesture.ratio = Math.min(
      10 / gesture.scale,
      Math.max(0.25 / gesture.scale, ratio),
    );
    if (!frame)
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (gesture) gesture.page.style.transform = `scale(${gesture.ratio})`;
      });
  }

  function finish(commit: boolean) {
    if (!gesture) return;
    const g = gesture;
    gesture = null;
    cancelAnimationFrame(frame);
    frame = 0;
    g.page.style.transform = "";
    g.page.style.transformOrigin = "";
    g.page.style.willChange = "";
    if (commit && Math.abs(g.ratio - 1) > 0.001) {
      const scale = g.scale * g.ratio;
      // Reactにも同時に通知し、次のリサイズ処理が以前の倍率を再適用しないようにする。
      options.onZoom(scale);
      g.viewer.currentScaleValue = String(scale);
      g.viewer.container.scrollLeft = g.originX * g.ratio - g.anchorX;
      g.viewer.container.scrollTop = g.originY * g.ratio - g.anchorY;
    }
    // 最後のpointerupを文字選択の確定として扱わない。
    release = window.setTimeout(() => options.onActive(false), 0);
  }

  function onTouchStart(event: TouchEvent) {
    if (
      !(event.target instanceof Element) ||
      !event.target.closest(".PdfHighlighter")
    )
      return;
    touches = event.touches.length;
    if (touches !== 2) return;
    event.preventDefault();
    const [a, b] = Array.from(event.touches);
    begin(
      (a.clientX + b.clientX) / 2,
      (a.clientY + b.clientY) / 2,
      Math.max(1, Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)),
    );
  }

  function onTouchMove(event: TouchEvent) {
    if (!gesture || event.touches.length !== 2) return;
    event.preventDefault();
    const [a, b] = Array.from(event.touches);
    preview(
      Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) /
        gesture.distance,
    );
  }

  function onTouchEnd(event: TouchEvent) {
    touches = event.touches.length;
    if (touches < 2) finish(event.type !== "touchcancel");
  }

  // 部品内のPointerEvent版と二重に拡大しない。通常のpointerdown/upは文字選択に使う。
  function onPointerMove(event: PointerEvent) {
    if (
      event.pointerType === "touch" &&
      event.target instanceof Element &&
      event.target.closest(".PdfHighlighter")
    )
      event.stopPropagation();
  }

  // Safariのトラックパッドはctrl+wheelではなくgestureイベントを送る。
  function onGesture(event: Event) {
    const e = event as GestureEvent;
    e.preventDefault();
    if (touches > 0) return;
    if (e.type === "gesturestart") begin(e.clientX, e.clientY, 1);
    else if (e.type === "gesturechange") preview(e.scale);
    else finish(true);
  }

  stage.addEventListener("touchstart", onTouchStart, { passive: false });
  stage.addEventListener("touchmove", onTouchMove, { passive: false });
  stage.addEventListener("touchend", onTouchEnd);
  stage.addEventListener("touchcancel", onTouchEnd);
  stage.addEventListener("pointermove", onPointerMove, true);
  stage.addEventListener("gesturestart", onGesture, { passive: false });
  stage.addEventListener("gesturechange", onGesture, { passive: false });
  stage.addEventListener("gestureend", onGesture);
  return () => {
    finish(false);
    window.clearTimeout(release);
    options.onActive(false);
    stage.removeEventListener("touchstart", onTouchStart);
    stage.removeEventListener("touchmove", onTouchMove);
    stage.removeEventListener("touchend", onTouchEnd);
    stage.removeEventListener("touchcancel", onTouchEnd);
    stage.removeEventListener("pointermove", onPointerMove, true);
    stage.removeEventListener("gesturestart", onGesture);
    stage.removeEventListener("gesturechange", onGesture);
    stage.removeEventListener("gestureend", onGesture);
  };
}
