const prisma = require("../models/prismaClient");

/**
 * Verifies the database connection on server startup.
 * Throws if unable to connect so the process exits early with a clear message.
 */
const connectDatabase = async () => {
  try {
    await prisma.$connect();
    console.log("✅  Database connected successfully (MySQL via Prisma)");
  } catch (error) {
    console.error("❌  Database connection failed:", error.message);
    process.exit(1); // Hard-stop — do not serve requests without a DB
  }
};

/**
 * Gracefully disconnects Prisma when the process is shutting down.
 */
const disconnectDatabase = async () => {
  await prisma.$disconnect();
  console.log("🔌  Database disconnected");
};

module.exports = { connectDatabase, disconnectDatabase };
