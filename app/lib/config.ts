export const config = {
  /** Slack に貼るリンクの起点。Vercel では本番のアドレスを自動で使う */
  baseUrl: (
    process.env.BASE_URL ??
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : "http://localhost:3000")
  ).replace(/\/$/, ""),
  slackBotToken: process.env.SLACK_BOT_TOKEN,
  slackSigningSecret:
    process.env.NODE_ENV !== "production"
      ? process.env.SLACK_DEV_SIGNING_SECRET || process.env.SLACK_SIGNING_SECRET
      : process.env.SLACK_SIGNING_SECRET,
  slackAppToken: process.env.SLACK_APP_TOKEN,
};
