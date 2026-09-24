import "./setup";
import assert from "node:assert/strict";
import { test } from "node:test";
import { NextRequest } from "next/server";
import { accessKey, KEY_COOKIE } from "../app/lib/access";
import * as documents from "../app/api/documents/route";
import { GET as detail } from "../app/api/documents/[id]/route";
import * as comments from "../app/api/versions/[id]/comments/route";
import { PATCH as edit } from "../app/api/comments/[id]/route";
import type {
  Comment,
  DocumentDetail,
  PaperSummary,
  UploadResult,
} from "../app/lib/contracts";
import { makePdf } from "./pdf";

async function request(path: string, method = "GET", body?: BodyInit) {
  return new NextRequest(`http://localhost${path}`, {
    method,
    body,
    headers: {
      cookie: `${KEY_COOKIE}=${await accessKey()}`,
      ...(typeof body === "string"
        ? { "content-type": "application/json" }
        : {}),
    },
  });
}
const context = (id: string) => ({ params: Promise.resolve({ id }) });

test("API契約：アップロード・一覧・詳細・コメントを実際のHTTP応答で確認する", async () => {
  const form = new FormData();
  form.set(
    "file",
    new File(
      [
        new Uint8Array(
          makePdf(["Contract test", "A paper for verifying API responses."]),
        ),
      ],
      "contract.pdf",
      { type: "application/pdf" },
    ),
  );
  const uploaded = await documents.POST(
    await request("/api/documents", "POST", form),
    context(""),
  );
  assert.equal(uploaded.status, 201);
  const result: UploadResult = await uploaded.json();
  assert.equal(typeof result.document.id, "string");
  assert.equal(result.version.number, 1);
  assert.equal(result.version.document_id, result.document.id);
  assert.equal(result.duplicate, false);
  assert.equal(result.isNewDocument, true);
  assert.ok(!("fingerprint" in result.version));

  const detailed = await detail(
    await request(`/api/documents/${result.document.id}`),
    context(result.document.id),
  );
  assert.equal(detailed.status, 200);
  const data: DocumentDetail = await detailed.json();
  assert.equal(data.document.slack_url, null);
  assert.equal(data.versions[0].id, result.version.id);
  assert.equal(data.versions[0].comment_count, 0);
  assert.equal(data.versions[0].open_count, 0);
  assert.equal(data.versions[0].suggested_title, null);
  assert.deepEqual(data.authors, []);
  assert.equal(data.review.stage, "open");

  const list: PaperSummary[] = await (
    await documents.GET(await request("/api/documents"), context(""))
  ).json();
  const summary = list.find((p) => p.id === result.document.id)!;
  assert.equal(summary.latest_version, 1);
  assert.equal(summary.comment_count, 0);
  assert.ok(!("latest_fingerprint" in summary));

  const response = await comments.POST(
    await request(
      "/api/versions/test/comments",
      "POST",
      JSON.stringify({
        author: "Tester",
        body: "First comment",
        kind: "general",
      }),
    ),
    context(result.version.id),
  );
  assert.equal(response.status, 201);
  const comment: Comment = await response.json();
  assert.equal(comment.status, "open");
  assert.equal(comment.position, null);
  assert.equal(comment.kind, "general");
  assert.deepEqual(comment.replies, []);
  const changed = await edit(
    await request(
      "/api/comments/test",
      "PATCH",
      JSON.stringify({ status: "resolved", body: "Changed" }),
    ),
    context(comment.id),
  );
  assert.equal(changed.status, 200);
  const saved: Comment = await changed.json();
  assert.equal(saved.status, "resolved");
  assert.equal(saved.body, "Changed");
  const listed: Comment[] = await (
    await comments.GET(
      await request("/api/versions/test/comments"),
      context(result.version.id),
    )
  ).json();
  assert.deepEqual(listed, [saved]);
});
