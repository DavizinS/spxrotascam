// app/api/user/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

export const runtime = "nodejs"; // Prisma precisa de Node runtime

const prisma = (globalThis as any).prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") (globalThis as any).prisma = prisma;

export async function GET(req: NextRequest, context: any) {
  const id = context?.params?.id as string | undefined;
  if (!id) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }


  const user = await prisma.user.findUnique({
    where: { id },
    select: { id: true, name: true, image: true },
  });

  if (!user) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({
    id: user.id,
    name: user.name ?? "",
    modal: user.image ?? "", // mapeia image -> modal
  });
}
