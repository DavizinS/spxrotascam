import NextAuth, { type NextAuthOptions } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";

const prisma = new PrismaClient();

export const authOptions: NextAuthOptions = {
  providers: [
    Credentials({
      name: "credentials",
      credentials: { email: {}, password: {} },
      async authorize(creds) {
        const user = await prisma.user.findUnique({ where: { email: creds!.email } });
        if (!user) return null;
        const ok = await bcrypt.compare(creds!.password, user.hashedPassword);
        if (!ok) return null;
        return { id: user.id, email: user.email };
      },
    }),
  ],
  pages: { signIn: "/login" },
  callbacks: {
    async signIn({ user }: any) {
      const newSessionId = randomUUID();
      await prisma.user.update({
        where: { id: user.id },
        data: { currentSessionId: newSessionId },
      });
      (user as any)._sessionId = newSessionId;
      return true;
    },
    async jwt({ token, user }: any) {
      if (user?._sessionId) token.sessionId = user._sessionId;
      return token;
    },
    async session({ session, token }: any) {
      (session as any).sessionId = token.sessionId;
      return session;
    },
  },
  session: {
    strategy: "jwt",
    maxAge: 60 * 60 * 12,
  },
  secret: process.env.NEXTAUTH_SECRET,
};

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };
