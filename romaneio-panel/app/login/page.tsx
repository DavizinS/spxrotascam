// app/login/page.tsx (SERVER)
import { Suspense } from "react";
import LoginClient from "./LoginClient";

export const dynamic = "force-dynamic";  // impede SSG
export const revalidate = 0;             // impede cache estático
export const runtime = "nodejs";         // evita edge (Prisma/NextAuth gostam de Node)
export const prerender = false;


export default function Page() {
  return (
    <Suspense fallback={<div className="p-6 text-center">Carregando…</div>}>
      <LoginClient />
    </Suspense>
  );
}
