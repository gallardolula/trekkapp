/** Process entry point. */
import { buildApp } from './app';
import { config } from './config';
import { pool } from './db/pool';

async function main(): Promise<void> {
  const app = buildApp({ logger: true });

  // A failure to reach the database should stop the process here rather
  // than surface as a 500 on the first request that needs it.
  await pool.query('SELECT 1');

  await app.listen({ port: config.port, host: config.host });

  // Render stops a service with SIGTERM. Closing the pool lets in-flight
  // queries finish instead of being cut mid transaction.
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      void (async () => {
        await app.close();
        await pool.end();
        process.exit(0);
      })();
    });
  }
}

main().catch((error) => {
  console.error('the server failed to start:', error);
  process.exit(1);
});
