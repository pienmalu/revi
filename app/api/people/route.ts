import { handle, json } from "@/app/lib/http";
import * as db from "@/app/lib/repo";

// 著者を入れるときの候補と、メンバーの一覧
export const GET = handle(async () => json(await db.listPeople()));
