"use client";

import { ConfirmHost } from "./Confirm";
import { Gate } from "./Gate";

/** すべての画面の外枠。研究室用リンクの鍵を確かめ、確認の画面を置く */
export function Shell({ children }: { children: React.ReactNode }) {
  return (
    <Gate>
      {children}
      <ConfirmHost />
    </Gate>
  );
}
