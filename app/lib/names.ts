// 人の名前の照合。書き方の違い（空白、大文字小文字、姓名の順、記号）を無視する。
// 例: "能勢山 春香" と "能勢山春香"、"Haruka Noseyama" と "NOSEYAMA Haruka" は同じとみなす。

const letters = (s: string) =>
  s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}]/gu, "");

/** 照合に使う形。文字だけを残す */
export const nameKey = (name: string) => letters(name);

/** 姓と名を入れ替えた形も含めた、照合に使う形の一覧 */
export function nameKeys(name: string): string[] {
  const parts = name
    .normalize("NFKC")
    .trim()
    .split(/[\s　,，・]+/)
    .filter(Boolean);
  const keys = new Set([letters(name)]);
  if (parts.length >= 2) keys.add(letters([...parts].reverse().join("")));
  return [...keys].filter(Boolean);
}

/** 短すぎる名前は、本文の中から探すと別の言葉に当たりやすい */
const MIN_SEARCH = 3;

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;

/**
 * PDF の頭の文章から、知っている人の名前を探す。著者の順に返す。
 * names は [人のID, 名前] の組。
 *
 * 和文の論文は、漢字の著者行とローマ字の著者行が並ぶことが多い。
 * 見つかった人が多いほうの書き方で順番を決め、もう一方でだけ見つかった人は、行の中の位置から差し込む。
 */
export function findNames(text: string, names: [string, string][]): string[] {
  type Hit = {
    id: string;
    script: "cjk" | "latin";
    line: number;
    at: number;
    fraction: number;
  };
  const hits = new Map<string, Hit>();
  text.split("\n").forEach((raw, line) => {
    const hay = letters(raw);
    if (!hay) return;
    const script = CJK.test(raw) ? "cjk" : "latin";
    for (const [id, name] of names) {
      // "haruka" のような1語のローマ字（Slack の表示名など）は、別の人の名前の一部に当たりやすい
      if (!CJK.test(name) && name.trim().split(/\s+/).length < 2) continue;
      for (const key of nameKeys(name)) {
        if (key.length < MIN_SEARCH) continue;
        const at = hay.indexOf(key);
        if (at < 0) continue;
        const hit = { id, script, line, at, fraction: at / hay.length } as Hit;
        const prev = hits.get(id);
        if (
          !prev ||
          hit.line < prev.line ||
          (hit.line === prev.line && hit.at < prev.at)
        )
          hits.set(id, hit);
      }
    }
  });
  const all = [...hits.values()];
  const cjk = all.filter((h) => h.script === "cjk");
  const primaryScript = cjk.length * 2 >= all.length ? "cjk" : "latin";
  const primary = all
    .filter((h) => h.script === primaryScript)
    .sort((a, b) => a.line - b.line || a.at - b.at);
  const order = primary.map((h) => h.id);
  for (const h of all
    .filter((x) => x.script !== primaryScript)
    .sort((a, b) => a.fraction - b.fraction)) {
    order.splice(
      Math.min(order.length, Math.round(h.fraction * (primary.length + 1))),
      0,
      h.id,
    );
  }
  return order;
}
