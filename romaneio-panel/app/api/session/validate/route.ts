import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export async function GET() {
  const session = await getServerSession(authOptions);

  return new Response(
    JSON.stringify({ authenticated: !!session }),
    { headers: { "content-type": "application/json" } }
  );
}
