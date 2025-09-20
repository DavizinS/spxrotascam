import { Suspense } from "react";
import LoginClient from "./LoginClient";

export const dynamic = "force-dynamic"; // sem SSG
export const revalidate = 0;            // sem cache estático
export const runtime = "nodejs";        // evita Edge

export default function Page() {
  return (
    <Suspense fallback={<div className="p-6 text-center">Carregando…</div>}>
      <LoginClient />
    </Suspense>
  );
}
