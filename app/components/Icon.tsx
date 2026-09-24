/**
 * 操作に添える小さな図（SF Symbols に似せた線の図）。
 * 「＋」「‹」「↓」のような文字の記号は字の形や高さが揃わないので、図で描く。
 * 色は文字の色（currentColor）、大きさは文字の大きさ（1em）に合わせる。
 */
const PATHS = {
  plus: "M8 3v10M3 8h10",
  minus: "M3 8h10",
  chevronLeft: "M10 3 5 8l5 5",
  chevronRight: "M6 3l5 5-5 5",
  chevronDown: "M3.5 6 8 10.5 12.5 6",
  chevronUp: "M3.5 10 8 5.5l4.5 4.5",
  download: "M8 2.5v8M4.5 7 8 10.5 11.5 7M3 13.5h10",
  check: "M3 8.5 6.5 12 13 4.5",
  xmark: "M4 4l8 8M12 4l-8 8",
  /** 絞り込み（line.3.horizontal.decrease） */
  filter: "M2.5 4.5h11M4.5 8h7M6.5 11.5h3",
  /** 共有（square.and.arrow.up） */
  share:
    "M8 1.75v8M5.25 4.5 8 1.75l2.75 2.75M5.5 6.5H4.25a.75.75 0 0 0-.75.75v6a.75.75 0 0 0 .75.75h7.5a.75.75 0 0 0 .75-.75v-6a.75.75 0 0 0-.75-.75H10.5",
} as const;

export type IconName = keyof typeof PATHS | "ellipsis";

export function Icon({ name }: { name: IconName }) {
  return (
    <svg
      className="icon"
      viewBox="0 0 16 16"
      width="1em"
      height="1em"
      aria-hidden
      focusable="false"
    >
      {name === "ellipsis" ? (
        <g fill="currentColor">
          <circle cx="3" cy="8" r="1.35" />
          <circle cx="8" cy="8" r="1.35" />
          <circle cx="13" cy="8" r="1.35" />
        </g>
      ) : (
        <path
          d={PATHS[name]}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
}
