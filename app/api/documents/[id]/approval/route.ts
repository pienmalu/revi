import { handle, json, readJson } from "@/app/lib/http";
import { personByName } from "@/app/lib/who";
import { approve } from "@/app/lib/workflow";

// 画面からの確認OK
export const POST = handle<{ id: string }>(async (req, { id }) => {
  const body = await readJson(req);
  const person = await personByName(body.author);
  await approve(id, person.id);
  return json({ ok: true });
});
