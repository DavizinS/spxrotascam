import { PrismaClient } from "@prisma/client";

export const runtime = "nodejs";

const prisma = (globalThis as any).prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") (globalThis as any).prisma = prisma;

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const user = await prisma.user.findUnique({
    where: { id: params.id },
    select: { id: true, name: true, image: true }, // image = modal
  });

  if (!user) {
    return new Response(JSON.stringify({ error: "Not found" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  }

  // devolve modal já mapeado a partir de image
  return new Response(
    JSON.stringify({
      id: user.id,
      name: user.name ?? "",
      modal: user.image ?? "",
    }),
    { headers: { "content-type": "application/json" } }
  );
}
