import { createApp } from './app.js';
import { config } from './config.js';

const app = createApp();

const server = app.listen(config.port, () => {
  console.log(`[tbf-api] listening on http://localhost:${config.port}  (${config.env})`);
  console.log('[tbf-api] POST /api/leads · GET /api/health');
});

// Shut down cleanly so an in-flight lead write is never cut off.
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    console.log(`\n[tbf-api] ${sig} received, closing.`);
    server.close(() => process.exit(0));
  });
}
