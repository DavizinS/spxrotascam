// lib/auth.ts
import type { NextAuthOptions } from "next-auth";
import Credentials from "next-auth/providers/credentials";

export const authOptions: NextAuthOptions = {
  providers: [
    Credentials({
      name: "credentials",
      credentials: { email: {}, password: {} },
      async authorize(creds) {
        // TODO: validar usuário no banco (Prisma)
        // Exemplo mínimo:
        if (!creds?.email || !creds?.password) return null;
        return { id: "1", name: "User", email: creds.email };
      },
    }),
  ],
  callbacks: {
    async signIn({ user }) {
      return !!user;
    },
    async jwt({ token, user }) {
      if (user) token.user = user as any;
      return token;
    },
    async session({ session, token }) {
      (session as any).user = token.user;
      return session;
    },
  },
};
