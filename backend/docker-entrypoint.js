const { execSync } = require("child_process");
const { PrismaClient } = require("@prisma/client");

const run = (cmd) => execSync(cmd, { stdio: "inherit" });

(async () => {
  console.log("[entrypoint] Syncing Prisma schema to database...");
  run("npx prisma db push --accept-data-loss --skip-generate");

  console.log("[entrypoint] Seeding tajweed rules (idempotent)...");
  run("node prisma/seed/tajweedRules.js");

  const prisma = new PrismaClient();
  const surahs = await prisma.quranicText.count();
  await prisma.$disconnect();

  if (surahs < 114) {
    console.log(`[entrypoint] Found ${surahs}/114 surahs — seeding Quran (5-8 min)...`);
    run("node prisma/seed/quran.js");
  } else {
    console.log(`[entrypoint] Quran already seeded (${surahs} surahs). Skipping.`);
  }

  console.log("[entrypoint] Starting server...");
  require("./server.js");
})().catch((err) => {
  console.error("[entrypoint] Fatal:", err);
  process.exit(1);
});
