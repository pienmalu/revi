import { useCallback, useState } from "react";

const KEY = "revi:author";

function read() {
  try {
    return localStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}

/** コメントに付ける名前。ブラウザごとに一度だけ聞いて覚えておく。 */
export function useAuthor() {
  const [author, setAuthorState] = useState(read);
  const setAuthor = useCallback((name: string) => {
    const trimmed = name.trim();
    setAuthorState(trimmed);
    try {
      localStorage.setItem(KEY, trimmed);
    } catch {
      // 保存できない環境では、このタブの間だけ覚える
    }
  }, []);
  return [author, setAuthor] as const;
}
