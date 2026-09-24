"use client";

import dynamic from "next/dynamic";
import { Suspense } from "react";

// PDF の表示部品はブラウザでしか動かないので、ブラウザで読み込む
const Review = dynamic(
  () => import("@/app/views/Review").then((m) => m.Review),
  {
    ssr: false,
    loading: () => <p className="stage__message">読み込み中…</p>,
  },
);

export default function Page() {
  return (
    <Suspense>
      <Review />
    </Suspense>
  );
}
