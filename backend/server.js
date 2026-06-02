/**
 * server.js — entry point. App composition (middleware + routes, including
 * WebSocket routes) lives in src/app.js. This file only handles process-level
 * concerns: env, DB connect, listen, signal handling.
 */

require('dotenv').config();

const app = require('./src/app');
const { connectDatabase, disconnectDatabase } = require('./src/config/database');

const PORT = parseInt(process.env.PORT, 10) || 5000;

async function start() {
  await connectDatabase();

  const HOST = process.env.HOST || '0.0.0.0';
  const server = app.listen(PORT, HOST, () => {
    console.log(`\n🚀  True Tilawah API is running`);
    console.log(`   Bound  →  ${HOST}:${PORT}`);
    console.log(`   REST   →  http://localhost:${PORT}/api`);
    console.log(`   WS     →  ws://localhost:${PORT}/ws/audio`);
    console.log(`   Health →  http://localhost:${PORT}/api/health\n`);
  });

  // ── Graceful shutdown ────────────────────────────────────────────────────────

  const shutdown = async (signal) => {
    console.log(`\n⚠️  ${signal} received – shutting down…`);
    server.close(async () => {
      await disconnectDatabase();
      console.log('✅  Clean shutdown complete');
      process.exit(0);
    });
    // Force-exit if graceful shutdown takes too long
    setTimeout(() => { console.error('❌  Forced exit'); process.exit(1); }, 10_000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));
  process.on('unhandledRejection', (r) => console.error('Unhandled rejection:', r));
  process.on('uncaughtException',  (e) => { console.error('Uncaught exception:', e); process.exit(1); });
}

start();
