import type { Metadata, Viewport } from "next";
import "./styles/vendor/pdfjs/pdf_viewer.css";
import "react-pdf-highlighter-plus/style/style.css";
import "./styles/tokens.css";
import "./styles/app.css";
import { Shell } from "./components/Shell";

export const metadata: Metadata = {
  title: "れび | revi",
  // 研究室の中だけで使う。検索エンジンに載せず、外のリンクへ鍵入りの URL を渡さない
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#ffffff",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja">
      <body>
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
