import { randomBytes, timingSafeEqual } from "node:crypto";
import type { NextResponse } from "next/server";
import { config } from "./config";
import * as db from "./repo";

// 研究室用のリンク。ログインの代わりに、リンクに入れた「鍵」を知っている人だけが開けるようにする。
// 一度開いたブラウザは鍵をクッキーに覚えるので、その後はブックマークからでも開ける。

const SETTING = "access_key";
export const KEY_COOKIE = "revi_key";
const MAX_AGE = 400 * 24 * 60 * 60; // ブラウザが許す上限（約13か月）

export async function accessKey() {
  const existing = await db.getSetting(SETTING);
  return (
    existing ??
    db.getOrCreateSetting(SETTING, randomBytes(18).toString("base64url"))
  );
}

/** 鍵を作り直す。これまでのリンクとクッキーは使えなくなる */
export async function rotateKey() {
  const key = randomBytes(18).toString("base64url");
  await db.setSetting(SETTING, key);
  return key;
}

/** 鍵入りのリンク。path には "/d/abc?v=2" のように検索条件を付けてよい */
export async function labUrl(path = "/") {
  return `${config.baseUrl}${path}${path.includes("?") ? "&" : "?"}k=${await accessKey()}`;
}

export async function keyMatches(given: unknown) {
  if (typeof given !== "string") return false;
  const a = Buffer.from(given);
  const b = Buffer.from(await accessKey());
  return a.length === b.length && timingSafeEqual(a, b);
}

export function setKeyCookie(res: NextResponse, key: string) {
  res.cookies.set(KEY_COOKIE, key, {
    path: "/",
    maxAge: MAX_AGE,
    httpOnly: true,
    sameSite: "lax",
    secure: config.baseUrl.startsWith("https:"),
  });
}
