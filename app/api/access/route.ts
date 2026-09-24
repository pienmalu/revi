import { labUrl } from "@/app/lib/access";
import { handle, json } from "@/app/lib/http";

export const GET = handle(async () => json({ url: await labUrl() }));
