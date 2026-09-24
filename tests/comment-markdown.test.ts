import "./setup";
import assert from "node:assert/strict";
import { test } from "node:test";
import { NextRequest } from "next/server";
import { commentsToMarkdown } from "../app/lib/comment-markdown";
import type { Comment } from "../app/lib/contracts";
import { accessKey, KEY_COOKIE } from "../app/lib/access";
import * as db from "../app/lib/repo";
import { GET } from "../app/api/versions/[id]/comments/markdown/route";

const rect = {
  x1: 10,
  y1: 20,
  x2: 40,
  y2: 60,
  width: 100,
  height: 200,
  pageNumber: 2,
};
const comment = (patch: Partial<Comment>): Comment => ({
  id: "c",
  version_id: "v",
  parent_id: null,
  author: "先輩",
  body: "この主張の根拠を追加",
  kind: "text",
  quote: "実験の結果\n有効だった。",
  position: { boundingRect: rect, rects: [rect] },
  status: "open",
  created_at: "2026-09-24T12:00:00Z",
  updated_at: "2026-09-24T12:00:00Z",
  copy_id: null,
  replies: [],
  ...patch,
});

test("Markdownは引用・位置・状態・返信を保持し、本文の記号と見出しが混ざらない", () => {
  const body = "改行\n```\n## 本文中の見出し\n<&>";
  const markdown = commentsToMarkdown({
    title: "原稿 [試験]",
    version: { number: 2, filename: "論文.pdf" },
    comments: [
      comment({
        kind: "area",
        id: "area",
        quote: null,
        status: "wontfix",
        body: "図の凡例を確認",
      }),
      comment({
        id: "text",
        status: "resolved",
        body,
        replies: [
          comment({
            id: "reply",
            author: "後輩",
            body: "追記します",
            position: null,
            quote: null,
            kind: null,
          }),
        ],
      }),
      comment({
        id: "general",
        kind: "general",
        position: null,
        quote: null,
        body: "全体の構成",
      }),
    ],
  });
  assert.ok(markdown.includes("原稿 \\[試験\\]"));
  assert.ok(markdown.indexOf("全体の構成") < markdown.indexOf("図の凡例"));
  for (const value of [
    "v2",
    "論文.pdf",
    "実験の結果\n有効だった。",
    "PDFページ: 2",
    "横 10.0–40.0%、縦 10.0–30.0%",
    "見送り",
    "対応済み",
    "後輩",
    "追記します",
    body,
  ])
    assert.ok(markdown.includes(value), value);
  assert.ok(markdown.includes("````text\n" + body + "\n````"));
  const empty = commentsToMarkdown({
    title: "空",
    version: { number: 1, filename: "空.pdf" },
    comments: [],
  });
  assert.ok(empty.includes("この版にはコメントがありません"));
});

test("Markdown取得APIは認証・版の分離・日本語ファイル名を守る", async () => {
  const d = await db.createDocument({
    title: "書き出しの試験",
    normalizedTitle: "markdown-test",
  });
  const a = (
    await db.addVersion({
      documentId: d.id,
      filename: "論文.pdf",
      sha256: "markdown-a",
    })
  ).version;
  const b = (
    await db.addVersion({
      documentId: d.id,
      filename: "論文.pdf",
      sha256: "markdown-b",
    })
  ).version;
  const c = await db.createComment({
    versionId: a.id,
    kind: "text",
    author: "先輩",
    body: "一文字への指摘",
    quote: "字",
    position: { boundingRect: rect, rects: [rect] },
  });
  await db.createComment({
    versionId: a.id,
    parentId: c.id,
    author: "本人",
    body: "対応します",
  });
  await db.createComment({
    versionId: b.id,
    kind: "general",
    author: "別の人",
    body: "別の版の指摘",
  });
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
  const request = (key?: string) =>
    new NextRequest("http://localhost/api/versions/test/comments/markdown", {
      headers: key ? { cookie: `${KEY_COOKIE}=${key}` } : {},
    });
  assert.equal((await GET(request(), ctx(a.id))).status, 401);
  const key = await accessKey();
  assert.equal((await GET(request(key), ctx("missing"))).status, 404);
  const response = await GET(request(key), ctx(a.id));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type")!, /text\/markdown/);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.ok(
    decodeURIComponent(response.headers.get("content-disposition")!).includes(
      "論文_v1_コメント.md",
    ),
  );
  const markdown = await response.text();
  assert.ok(markdown.includes("一文字への指摘"));
  assert.ok(markdown.includes("対応します"));
  assert.ok(markdown.includes("\n字\n"));
  assert.ok(!markdown.includes("別の版の指摘"));
  assert.ok(!markdown.includes(key));
});
