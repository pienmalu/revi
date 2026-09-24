// 画面から来た操作の「誰が」。画面にはログインが無いので、最初に選んだ名前で人を探す
import { HttpError, requireText } from "./http";
import * as db from "./repo";

export async function personByName(value: unknown) {
  const name = requireText(value, "名前");
  const person = await db.findPersonByName(name);
  if (!person)
    throw new HttpError(
      400,
      `「${name}」さんがメンバーにいません。名前を選び直してください`,
    );
  return person;
}
