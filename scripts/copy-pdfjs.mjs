// PDF.js の worker と、日本語などを描くための文字の対応表（cmaps）と標準フォントを public/pdfjs に写す。
// ブラウザはここから読み込む（node_modules は配信されないため）。pnpm install と dev / build の前に動く。
// 表示用の pdf_viewer.css（と中で使う画像）は app/styles/vendor/pdfjs に写し、layout.tsx から読む。
// pdfjs-dist はサーバーでは外部のパッケージ扱い（next.config.ts）なので、直接 import すると警告が出るため。
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = path.dirname(require.resolve("pdfjs-dist/package.json"));
const out = path.join(process.cwd(), "public", "pdfjs");
fs.mkdirSync(out, { recursive: true });
fs.copyFileSync(
  path.join(root, "build", "pdf.worker.min.mjs"),
  path.join(out, "pdf.worker.min.mjs"),
);
for (const dir of ["cmaps", "standard_fonts"]) {
  fs.cpSync(path.join(root, dir), path.join(out, dir), { recursive: true });
}

const css = path.join(process.cwd(), "app", "styles", "vendor", "pdfjs");
fs.mkdirSync(css, { recursive: true });
fs.copyFileSync(
  path.join(root, "web", "pdf_viewer.css"),
  path.join(css, "pdf_viewer.css"),
);
fs.cpSync(path.join(root, "web", "images"), path.join(css, "images"), {
  recursive: true,
});
