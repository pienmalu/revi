"use client";

import { useCallback, useEffect, useState } from "react";
import { Jp } from "@/app/components/Jp";

export function useToast() {
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    if (!message) return;
    const id = window.setTimeout(() => setMessage(null), 3200);
    return () => window.clearTimeout(id);
  }, [message]);
  const node = message ? (
    <div className="toast" role="status">
      <Jp>{message}</Jp>
    </div>
  ) : null;
  return [node, useCallback((m: string) => setMessage(m), [])] as const;
}
