// app/api/auth/[...nextauth]/route.ts
import NextAuth from "next-auth";
import { authOptions } from "@/lib/auth";

const handler = NextAuth(authOptions);

export const runtime = "nodejs";        // ✅ importante p/ NextAuth v5 no App Router
export const dynamic = "force-dynamic";

export { handler as GET, handler as POST };
