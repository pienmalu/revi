"use client";

import { useEffect, useState, type ReactNode } from "react";
import Image from "next/image";
import brandIcon from "@/app/icon.png";
import { LOCKED_EVENT } from "@/app/lib/client/api";
import { Jp } from "@/app/components/Jp";

/**
 * 研究室用のリンク（?k=鍵）で開かれたら、鍵をブラウザに覚えさせてから画面を出す。
 * 鍵を覚えていないブラウザには、リンクから開くよう案内だけを出す。
 */
export function Gate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<"checking" | "open" | "locked">(
    "checking",
  );

  useEffect(() => {
    const onLocked = () => setState("locked");
    window.addEventListener(LOCKED_EVENT, onLocked);
    (async () => {
      const url = new URL(window.location.href);
      const key = url.searchParams.get("k");
      if (key) {
        await fetch("/api/unlock", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key }),
        });
        // 画面の URL から鍵を消す（そのままコピーして人に送らないように）
        url.searchParams.delete("k");
        window.history.replaceState(
          window.history.state,
          "",
          url.pathname + url.search + url.hash,
        );
      }
      const res = await fetch("/api/access");
      setState(res.status === 401 ? "locked" : "open");
    })().catch(() => setState("open")); // つながらないときは、各画面にエラーを出させる
    return () => window.removeEventListener(LOCKED_EVENT, onLocked);
  }, []);

  if (state === "checking") return null;
  if (state === "locked") {
    return (
      <div className="lock">
        <div className="lock__card">
          <h1>
            <Image src={brandIcon} width={56} height={56} alt="" />
            れび
          </h1>
          <p>研究室用のリンクから開いてください。</p>
          <p className="lock__note">
            <Jp>
              {
                "Slack のボットのメッセージや Notion にあるリンクを一度開くと、このブラウザで使えるようになります。\nリンクが再発行されたときは、新しいリンクから開き直してください。"
              }
            </Jp>
          </p>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}
