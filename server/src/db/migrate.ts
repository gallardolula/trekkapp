/** Migration runner.
 *
 *  Applies the .sql files of this directory in filename order and records
 *  each one, so running it twice is harmless. Each migration runs inside a
 *  transaction: a failure leaves the schema as it was rather than half
 *  applied.
 *
 *  Usage: npm run migrate
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { pool, withTransaction } from './pool';

const DIRECTORY = join(__dirname, 'migrations');

async function run(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name        TEXT PRIMARY KEY,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);

  const applied = new Set(
    (await pool.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map(
      (r) => r.name,
    ),
  );

  const files = readdirSync(DIRECTORY).filter((f) => f.endsWith('.sql')).sort();
  let count = 0;

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(DIRECTORY, file), 'utf8');
    await withTransaction(async (client) => {
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
    });
    console.log(`  applied ${file}`);
    count++;
  }

  console.log(count === 0 ? 'no pending migrations' : `${count} migration(s) applied`);
  await pool.end();
}

run().catch((error) => {
  console.error('migration failed:', error.message);
  process.exit(1);
});
