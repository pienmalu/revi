import { NextResponse, type NextRequest } from "next/server";
import { KEY_COOKIE, keyMatches } from "./access";
import { HttpError, IngestError } from "./errors";
export { HttpError } from "./errors";

export const json = <T = unknown>(data: T, status = 200) =>
  NextResponse.json(data, { status });

export function requireText(value: unknown, field: string) {
  if (typeof value !== "string" || !value.trim())
    throw new HttpError(400, `${field} を入力してください`);
  return value.trim();
}

export const optionalText = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : null;

export function optionalDate(value: unknown, field: string) {
  const s = optionalText(value);
  if (s && !/^\d{4}-\d{2}-\d{2}$/.test(s))
    throw new HttpError(400, `${field}は YYYY-MM-DD の形で入れてください`);
  return s;
}

export function optionalMonth(value: unknown, field: string) {
  const s = optionalText(value);
  if (s && !/^\d{4}-\d{2}$/.test(s))
    throw new HttpError(400, `${field}は YYYY-MM の形で入れてください`);
  return s;
}

type Context<P> = { params: Promise<P> };

/**
 * API の入口。研究室用リンクの鍵を確かめ、失敗を JSON にして返す。
 * open: true の API（鍵を覚えさせる入口など）は鍵を確かめない。
 */
export function handle<P = Record<string, string>>(
  fn: (req: NextRequest, params: P) => Promise<Response>,
  options: { open?: boolean } = {},
) {
  return async (req: NextRequest, ctx: Context<P>) => {
    try {
      if (
        !options.open &&
        !(await keyMatches(req.cookies.get(KEY_COOKIE)?.value))
      ) {
        return json(
          { error: "研究室用のリンクから開いてください", locked: true },
          401,
        );
      }
      return await fn(req, await ctx.params);
    } catch (err) {
      if (err instanceof HttpError)
        return json({ error: err.message }, err.status);
      if (err instanceof IngestError) return json({ error: err.message }, 400);
      console.error(err);
      return json({ error: "サーバーでエラーが起きました" }, 500);
    }
  };
}

export async function readJson(
  req: NextRequest,
): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    return body && typeof body === "object" ? body : {};
  } catch {
    return {};
  }
}
