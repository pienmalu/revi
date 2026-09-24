import { Suspense } from "react";
import { Home } from "./views/Home";

export default function Page() {
  return (
    <Suspense>
      <Home />
    </Suspense>
  );
}
