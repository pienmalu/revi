import assert from "node:assert/strict";
import { test } from "node:test";
import { installTouchZoom } from "../app/lib/client/touch-zoom";

// Native gesture events are tested separately from React/PDF rendering.
test("two-finger zoom commits around the fingers, leaves one-finger scrolling alone, and cleans up", () => {
  const originals = Object.getOwnPropertyDescriptors(globalThis);
  const page = {
    style: { transform: "", transformOrigin: "", willChange: "" },
  };
  class ElementStub extends EventTarget {
    closest() {
      return this;
    }
  }
  const stage = new ElementStub();
  const container = {
    scrollLeft: 30,
    scrollTop: 100,
    getBoundingClientRect: () => ({ left: 10, top: 20 }),
    querySelector: () => page,
  };
  const viewer = {
    currentScale: 1,
    get currentScaleValue() {
      return String(this.currentScale);
    },
    set currentScaleValue(value: string) {
      this.currentScale = Number(value);
    },
    container,
  };
  const scales: number[] = [];
  let active = false;
  let frame: (() => void) | undefined;
  Object.assign(globalThis, {
    Element: ElementStub,
    window: { setTimeout, clearTimeout },
    requestAnimationFrame: (callback: () => void) => {
      frame = callback;
      return 1;
    },
    cancelAnimationFrame: () => {
      frame = undefined;
    },
  });
  const dispatch = (type: string, points: number[][]) => {
    const event = new Event(type, { cancelable: true });
    Object.assign(event, {
      touches: points.map(([clientX, clientY]) => ({ clientX, clientY })),
    });
    stage.dispatchEvent(event);
    return event;
  };
  let cleanup: (() => void) | undefined;
  try {
    cleanup = installTouchZoom(stage as unknown as HTMLElement, {
      viewer: () => viewer as never,
      onZoom: (scale) => scales.push(scale),
      onActive: (value) => {
        active = value;
      },
    });
    assert.equal(dispatch("touchstart", [[60, 120]]).defaultPrevented, false);
    assert.equal(dispatch("touchmove", [[60, 140]]).defaultPrevented, false);
    assert.equal(
      dispatch("touchstart", [
        [60, 120],
        [160, 120],
      ]).defaultPrevented,
      true,
    );
    assert.equal(active, true);
    assert.equal(
      dispatch("touchmove", [
        [10, 120],
        [210, 120],
      ]).defaultPrevented,
      true,
    );
    frame?.();
    assert.equal(page.style.transform, "scale(2)");
    dispatch("touchend", [[10, 120]]);
    assert.deepEqual(scales, [2]);
    assert.equal(viewer.currentScaleValue, "2");
    assert.equal(container.scrollLeft, 160);
    assert.equal(container.scrollTop, 300);
    assert.equal(page.style.transform, "");

    dispatch("touchstart", [
      [60, 120],
      [160, 120],
    ]);
    dispatch("touchmove", [
      [10, 120],
      [310, 120],
    ]);
    dispatch("touchcancel", []);
    assert.deepEqual(scales, [2], "cancel must not save a partial gesture");
    assert.equal(page.style.willChange, "");

    // Safari trackpad gesture events use the same commit path.
    const safari = (type: string, scale: number) => {
      const event = new Event(type, { cancelable: true });
      Object.assign(event, { clientX: 110, clientY: 120, scale });
      stage.dispatchEvent(event);
      assert.equal(event.defaultPrevented, true);
    };
    safari("gesturestart", 1);
    safari("gesturechange", 1.5);
    safari("gestureend", 1.5);
    assert.deepEqual(scales, [2, 3]);

    cleanup();
    cleanup = undefined;
    assert.equal(active, false);
    assert.equal(
      dispatch("touchstart", [
        [60, 120],
        [160, 120],
      ]).defaultPrevented,
      false,
    );
  } finally {
    cleanup?.();
    for (const key of [
      "Element",
      "window",
      "requestAnimationFrame",
      "cancelAnimationFrame",
    ]) {
      const descriptor = originals[key];
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
