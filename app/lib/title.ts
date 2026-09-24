// ファイル名から版番号・日付・「修正版」などを取り除き、同じ原稿かどうかの照合と表示に使う。
// 例: "paper_v3_0923.pdf" と "paper-final.pdf" はどちらも "paper" になる。
const TRAILING_PATTERNS = [
  /\(\d+\)$/, // Finder やブラウザが付ける "(1)"
  /(のコピー|\scopy)$/i, // Finder の複製
  /(v|ver|rev)\.?\d+([._]\d+)*$/i, // v2, ver3, rev1, v1.2
  /[\s_\-.]r\d+$/i, // _r2（単語の途中の "r2" は消さない）
  // 日付は区切りの後ろにあるものだけ消す（"ICASSP2027" の年は残す）
  /[\s_\-.]\d{4}[-_.]?\d{2}[-_.]?\d{2}$/, // _2026-09-23
  /[\s_\-.]\d{6}$/, // _260923
  /[\s_\-.]\d{4}$/, // _0923
  /(final|draft|latest|submit(ted)?|revised|fixed)$/i,
  /(修正版?|改訂版?|最新版?|提出版?|確認用|添削済み?|完成版?|最終版?|第\d+[稿版])$/,
];

function stripTrailing(s: string): string {
  for (let changed = true; changed;) {
    changed = false;
    s = s.replace(/[\s_\-.]+$/, "");
    for (const pattern of TRAILING_PATTERNS) {
      const next = s.replace(pattern, "");
      if (next !== s && next.replace(/[\s_\-.]+$/, "").length > 0) {
        s = next;
        changed = true;
      }
    }
  }
  return s;
}

const withoutExtension = (filename: string) =>
  filename.replace(/\.pdf$/i, "").trim() || filename;

/** 一覧に出す題名。版番号などを除き、区切りの "_" を空白にする（"ICTSSL_能勢山_第1版" → "ICTSSL 能勢山"） */
export function displayTitle(filename: string): string {
  const base = withoutExtension(filename).normalize("NFKC");
  return (
    stripTrailing(base).replace(/_+/g, " ").replace(/\s+/g, " ").trim() || base
  );
}

/** 照合用の題名。大文字小文字と区切り記号の違いを無視する */
export function normalizeTitle(filename: string): string {
  const s = stripTrailing(
    withoutExtension(filename).normalize("NFKC").toLowerCase().trim(),
  );
  return s.replace(/[\s_\-.]+/g, " ").trim();
}
