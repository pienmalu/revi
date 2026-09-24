import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Excelと開発用DBはnode_modulesから読む。PDF.jsはworkerも含めてビルドする。
  serverExternalPackages: ["exceljs", "@electric-sql/pglite"],
  // PDF の読み取り（analyze.ts）が使う文字の対応表と標準フォントを、Vercel に一緒に置く
  outputFileTracingIncludes: {
    "/api/**/*": [
      "./node_modules/pdfjs-dist/cmaps/**",
      "./node_modules/pdfjs-dist/standard_fonts/**",
      "./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
      "./db/migrations/**",
    ],
  },
  // 利用者データは実行環境で保持し、アプリの配布物には同梱しない。
  outputFileTracingExcludes: {
    "*": ["./data/**/*"],
  },
  async headers() {
    return [
      {
        // 検索エンジンに載せない。リンク先に鍵入りの URL を漏らさない
        source: "/:path*",
        headers: [
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
          { key: "Referrer-Policy", value: "no-referrer" },
        ],
      },
    ];
  },
};

export default nextConfig;
