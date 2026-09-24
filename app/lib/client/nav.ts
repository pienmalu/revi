"use client";

// 画面の移動と、移動した先で出す知らせ（「原稿を削除しました」など）。
// 知らせは sessionStorage に一度だけ置き、移動先で読んで消す。
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect } from "react";

const FLASH = "lr_toast";

export function useNav() {
  const router = useRouter();
  return useCallback(
    (path: string, options: { replace?: boolean; toast?: string } = {}) => {
      if (options.toast) {
        try {
          sessionStorage.setItem(FLASH, options.toast);
        } catch {
          // 知らせが出ないだけ
        }
      }
      if (options.replace) router.replace(path);
      else router.push(path);
    },
    [router],
  );
}

/** 前の画面から渡された知らせを出す */
export function useFlash(show: (message: string) => void) {
  useEffect(() => {
    try {
      const message = sessionStorage.getItem(FLASH);
      if (message) {
        sessionStorage.removeItem(FLASH);
        show(message);
      }
    } catch {
      // 知らせが出ないだけ
    }
  }, [show]);
}

/** URL の検索条件を読み書きする（戻る・ブックマークでそのまま再現できるように） */
export function useQuery() {
  const params = useSearchParams();
  const router = useRouter();
  const set = useCallback(
    (next: Record<string, string>) => {
      const p = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(next)) {
        if (v) p.set(k, v);
        else p.delete(k);
      }
      const q = p.toString();
      router.replace(q ? `?${q}` : window.location.pathname, { scroll: false });
    },
    [params, router],
  );
  return [params, set] as const;
}
