"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/app/components/Icon";

type Item = {
  label: string;
  onSelect?(): void;
  /** 押すと開くリンク（PDFの保存など） */
  href?: string;
  danger?: boolean;
  /** いま選んでいるもの（左に ✓ を付ける） */
  checked?: boolean;
  /** 押せない小見出し（Mac のメニューの項目名）。線は引かずに字だけで分ける */
  heading?: boolean;
};

type Place = { top: number; left?: number; right?: number };

/** ボタンを押すと開く、小さなメニュー */
export function DropMenu({
  label,
  items,
  className = "btn",
  ariaLabel,
}: {
  label: ReactNode;
  items: Item[];
  className?: string;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState<Place | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || listRef.current?.contains(t)) return;
      setOpen(null);
      // Mac のメニューと同じく、外を押したときは閉じるだけにし、下にあるボタンは押さない
      const swallow = (ev: Event) => {
        ev.stopPropagation();
        ev.preventDefault();
      };
      window.addEventListener("click", swallow, { capture: true, once: true });
      // 指を離したあとにクリックが起きなかったとき（ドラッグなど）は、次のクリックを止めない
      window.addEventListener(
        "pointerup",
        () =>
          setTimeout(() =>
            window.removeEventListener("click", swallow, { capture: true }),
          ),
        { capture: true, once: true },
      );
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(null);
    const dismiss = () => setOpen(null);
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", esc);
    // 動いた中身にメニューだけが取り残されないよう、スクロールしたら閉じる
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", esc);
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", dismiss);
    };
  }, [open]);

  return (
    <div className="menu" ref={ref}>
      <button
        className={className}
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={Boolean(open)}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const gap = 8;
          // 画面の右半分にあるボタンは、メニューの右端をボタンの右端にそろえる（Mac のメニューと同じ）
          const place: Place =
            r.left + r.width / 2 > window.innerWidth / 2
              ? {
                  top: r.bottom + 4,
                  right: Math.max(gap, window.innerWidth - r.right),
                }
              : { top: r.bottom + 4, left: Math.max(gap, r.left) };
          setOpen((o) => (o ? null : place));
        }}
      >
        {label}
      </button>
      {/* 下から出る欄（transform のかかった親）の中でも、押した場所のすぐ下に出すため、body の直下に置く */}
      {open &&
        createPortal(
          <div
            ref={listRef}
            className={[
              "menu__list",
              open.right !== undefined && "menu__list--end",
              items.some((i) => i.checked !== undefined) && "menu__list--check",
            ]
              .filter(Boolean)
              .join(" ")}
            role="menu"
            style={open}
          >
            {items.map((item) => {
              if (item.heading)
                return (
                  <div
                    key={item.label}
                    className="menu__heading"
                    role="presentation"
                  >
                    {item.label}
                  </div>
                );
              const className = item.danger ? "menu__danger" : undefined;
              const select = () => {
                setOpen(null);
                item.onSelect?.();
              };
              return item.href ? (
                <a
                  key={item.label}
                  role="menuitem"
                  className={className}
                  href={item.href}
                  onClick={select}
                >
                  {item.label}
                </a>
              ) : (
                <button
                  key={item.label}
                  role={
                    item.checked === undefined ? "menuitem" : "menuitemradio"
                  }
                  className={className}
                  onClick={select}
                  aria-checked={item.checked}
                >
                  {item.checked && <Icon name="check" />}
                  {item.label}
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </div>
  );
}
