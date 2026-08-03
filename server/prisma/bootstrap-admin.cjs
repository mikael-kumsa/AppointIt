const { PrismaClient, UserRole } = require("@prisma/client");
const bcrypt = require("bcryptjs");

const prisma = new PrismaClient();

async function main() {
  const name = process.env.ADMIN_NAME?.trim() || "Platform Admin";
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;

  if (!email || !email.includes("@")) throw new Error("ADMIN_EMAIL must be a valid email address");
  if (!password || password.length < 12) throw new Error("ADMIN_PASSWORD must contain at least 12 characters");

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing && existing.role !== UserRole.SUPER_ADMIN) {
    throw new Error("ADMIN_EMAIL already belongs to a non-super-admin account");
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.upsert({
    where: { email },
    update: { name, passwordHash, active: true },
    create: { name, email, passwordHash, role: UserRole.SUPER_ADMIN, active: true }
  });

  console.log(`Super admin ready: ${user.email}`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
