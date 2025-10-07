// lib/auth.ts
import type { NextAuthOptions } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

export const authOptions: NextAuthOptions = {
  providers: [
    Credentials({
      name: "credentials",
      credentials: { email: {}, password: {} },
      async authorize(creds) {
        if (!creds?.email || !creds?.password) return null;

        // sem select, pega todos os campos do modelo do Prisma
        const user = await prisma.user.findUnique({ where: { email: creds.email } });
        if (!user || !user.password) return null;

        const ok = await bcrypt.compare(creds.password, user.password);
        if (!ok) return null;

        // pega 'modal' OU 'image' do modelo (qual você tiver no schema)
        const modalVal =
          (user as any).modal ??
          (user as any).image ??
          null;

        // devolve 'image' só para carregar via callback (usamos como MODAL)
        return {
          id: String(user.id),
          name: user.name ?? user.email ?? "User",
          email: user.email ?? undefined,
          image: modalVal ?? undefined,
        } as any;
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        (token as any).modal = (user as any).image ?? null;
      }
      return token;
    },
    async session({ session, token }) {
      (session.user as any).id = token.sub as string;
      (session.user as any).modal = (token as any).modal ?? null;
      return session;
    },
  },
};

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
