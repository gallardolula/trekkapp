/** Builds the test database from the real migrations.
 *
 *  Every migration, in order, and not just the first one. The tests used to
 *  read `001_initial.sql` by hand in three separate files, which meant a
 *  later migration was never exercised and the suite passed against a
 *  schema the server would never actually run on.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Pool } from 'pg';

const DIRECTORY = join(__dirname, '..', 'db', 'migrations');

export async function resetSchema(pool: Pool): Promise<void> {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  for (const file of readdirSync(DIRECTORY).filter((f) => f.endsWith('.sql')).sort()) {
    await pool.query(readFileSync(join(DIRECTORY, file), 'utf8'));
  }
}
