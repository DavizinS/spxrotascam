// app/login/page.tsx
"use client";

import { Suspense, useState } from "react";
import { signIn } from "next-auth/react";
import { useSearchParams, useRouter } from "next/navigation";

export const dynamic = "force-dynamic"; // evita problemas de prerender em /login

function LoginInner() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const sp = useSearchParams();              // ✅ agora dentro de <Suspense>
  const router = useRouter();
  const error = sp.get("error");

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await signIn("credentials", {
      email,
      password,
      redirect: false,
      callbackUrl: "/",
    });
    if (res?.ok) router.push(res.url || "/");
    else alert("Login inválido");
  };

  return (
    <main className="min-h-screen grid place-items-center bg-zinc-50">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm rounded-2xl bg-white p-6 shadow border"
      >
        <h1 className="text-xl font-semibold">Entrar</h1>
        <p className="mt-1 text-sm text-zinc-500">Use seu e-mail e senha.</p>

        {error && (
          <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        <label className="mt-4 block text-sm">E-mail</label>
        <input
          className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          type="email"
          required
        />

        <label className="mt-3 block text-sm">Senha</label>
        <input
          className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          type="password"
          required
        />

        <button
          type="submit"
          className="mt-5 w-full rounded-xl bg-zinc-900 px-3 py-2 text-sm text-white hover:opacity-90"
        >
          Entrar
        </button>
      </form>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="p-6 text-center">Carregando…</div>}>
      <LoginInner />
    </Suspense>
  );
}
