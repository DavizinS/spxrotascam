// middleware.ts (raiz)
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export async function middleware(req: NextRequest) {
  // deixe passar preflight/CORS
  if (req.method === "OPTIONS") return NextResponse.next();

  const validateUrl = new URL("/api/session/validate", req.url);

  try {
    const res = await fetch(validateUrl, {
      headers: { cookie: req.headers.get("cookie") || "" },
      cache: "no-store",
    });

    if (res.status === 200) {
      return NextResponse.next();
    }
  } catch (e) {
    // Falha de rede/servidor: trate como inválido (mais seguro)
  }

  // sessão inválida → manda pro signout com retorno para /login
  const redirect = new URL("/api/auth/signout?callbackUrl=/login", req.url);
  return NextResponse.redirect(redirect);
}

export const config = {
  matcher: [
    // Protege tudo, menos:
    // - Auth do NextAuth
    // - Validador de sessão
    // - Assets/estáticos
    // - Página de login
    "/((?!api/auth|api/session/validate|_next|static|favicon.ico|login|public).*)",
  ],
};
