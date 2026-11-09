/** Process entry point. */
import { buildApp } from './app';
import { config } from './config';
import { pool } from './db/pool';
import { mailConfigured } from './mail/mailer';

async function main(): Promise<void> {
  const app = buildApp({ logger: true });

  // A failure to reach the database should stop the process here rather
  // than surface as a 500 on the first request that needs it.
  await pool.query('SELECT 1');

  // Said once, at startup, and not only when the first code is sent. A
  // server with no mail account still registers accounts and still writes
  // their codes somewhere, so without this line the first anybody hears of
  // it is a person who never received theirs.
  if (!mailConfigured()) {
    app.log.warn(
      'mail is not configured (SMTP_HOST, SMTP_USER, SMTP_PASS): ' +
        'verification codes are written to this log and delivered to nobody',
    );
  }

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
