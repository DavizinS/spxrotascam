// scripts/seed.ts
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
const prisma = new PrismaClient();

async function main() {
  const email = "admin@exemplo.com";
  const password = "senha-forte";
  const hashed = await bcrypt.hash(password, 10);
  await prisma.user.upsert({
    where: { email },
    update: {},
    create: { email, hashedPassword: hashed },
  });
  console.log("Usuário seed:", email, "senha:", password);
}
main().finally(()=>prisma.$disconnect());
