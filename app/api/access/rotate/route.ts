import { NextResponse } from "next/server";
import { labUrl, rotateKey, setKeyCookie } from "@/app/lib/access";
import { handle } from "@/app/lib/http";

// 作り直した本人のブラウザは、新しい鍵をそのまま覚える
export const POST = handle(async () => {
  const key = await rotateKey();
  const res = NextResponse.json({ url: await labUrl() });
  setKeyCookie(res, key);
  return res;
});
