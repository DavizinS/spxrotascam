import { Suspense } from "react";
import HomeClient from "./HomeClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function Page() {
  return (
    <Suspense fallback={<div className="p-6 text-center">Carregando…</div>}>
      <HomeClient />
    </Suspense>
  );
}
