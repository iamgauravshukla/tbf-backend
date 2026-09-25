import { createApp } from './app.js';
import { config } from './config.js';
import { ensureSchema, pgEnabled } from './lib/pg.js';
import { seedAdminIfEmpty } from './lib/users.js';

const app = createApp();

async function start() {
  // Create the Postgres schema if needed (no-op without DATABASE_URL), then make
  // sure there is always an admin to log in with.
  await ensureSchema();
  await seedAdminIfEmpty();

  const server = app.listen(config.port, () => {
    console.log(`[tbf-api] listening on http://localhost:${config.port}  (${config.env})`);
    console.log(`[tbf-api] storage: ${pgEnabled ? 'postgres' : 'json files'}`);
    console.log('[tbf-api] POST /api/leads · GET /api/health');
  });

  // Shut down cleanly so an in-flight write is never cut off.
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => {
      console.log(`\n[tbf-api] ${sig} received, closing.`);
      server.close(() => process.exit(0));
    });
  }
}

start().catch((err) => {
  console.error('[tbf-api] failed to start:', err);
  process.exit(1);
});
