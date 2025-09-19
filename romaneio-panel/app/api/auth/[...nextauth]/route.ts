import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "crypto";
const prisma = new PrismaClient();

export const authOptions = {
  providers: [
    Credentials({
      name: "credentials",
      credentials: { email: {}, password: {} },
      async authorize(creds) {
        const user = await prisma.user.findUnique({ where: { email: creds!.email } });
        if (!user) return null;
        return { id: user.id, email: user.email };
      }
    })
  ],
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
  }
};

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST }