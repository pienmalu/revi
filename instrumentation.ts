// サーバーが起動したときに一度だけ動く。研究室用のリンクをログに出す（最初に開くときに使う）
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { labUrl } = await import("./app/lib/access");
  try {
    console.log(`[revi] 研究室用のリンク: ${await labUrl()}`);
  } catch (err) {
    console.error("[revi] データベースにつながりませんでした", err);
  }
}
