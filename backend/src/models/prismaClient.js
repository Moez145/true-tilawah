const { PrismaClient } = require("@prisma/client");

// Singleton pattern — prevents multiple PrismaClient instances in dev (hot-reload)
let prisma;

if (process.env.NODE_ENV === "production") {
  prisma = new PrismaClient({
    log: ["error", "warn"],
  });
} else {
  // In dev, store on global to survive module reloads (nodemon)
  if (!global.__prisma) {
    global.__prisma = new PrismaClient({
      log: ["query", "error", "warn"],
    });
  }
  prisma = global.__prisma;
}

module.exports = prisma;
