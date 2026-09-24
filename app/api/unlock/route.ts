import { NextResponse } from "next/server";
import { accessKey, keyMatches, setKeyCookie } from "@/app/lib/access";
import { handle, json, readJson } from "@/app/lib/http";

/** リンクの鍵を確かめて、ブラウザに覚えさせる */
export const POST = handle(
  async (req) => {
    const { key } = await readJson(req);
    if (!(await keyMatches(key)))
      return json(
        { error: "リンクが古いか、まちがっています", locked: true },
        401,
      );
    const res = new NextResponse(null, { status: 204 });
    setKeyCookie(res, await accessKey());
    return res;
  },
  { open: true },
);
