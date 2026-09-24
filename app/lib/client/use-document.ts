"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, type DocumentDetail } from "./api";

/** 呼び出し元は原稿IDでkeyを付ける。古い取得結果は新しい表示を上書きしない。 */
export function useDocument(documentId: string) {
  const [document, setDocument] = useState<DocumentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sequence = useRef({ request: 0 });
  const reload = useCallback(async () => {
    const request = ++sequence.current.request;
    const result = await api.document(documentId);
    if (request === sequence.current.request) {
      setDocument(result);
      setError(null);
    }
  }, [documentId]);

  useEffect(() => {
    let active = true;
    const scope = sequence.current;
    const initial = reload();
    const request = scope.request;
    initial.catch((e: Error) => {
      if (active && request === scope.request) setError(e.message);
    });
    const refresh = () => {
      if (window.document.visibilityState === "visible")
        reload().catch(() => {});
    };
    window.addEventListener("focus", refresh);
    window.document.addEventListener("visibilitychange", refresh);
    return () => {
      active = false;
      scope.request++;
      window.removeEventListener("focus", refresh);
      window.document.removeEventListener("visibilitychange", refresh);
    };
  }, [reload]);
  return { document, error, reload };
}
