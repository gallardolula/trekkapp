/** Connection pool.
 *
 *  A single pool for the whole process. Opening a connection per request
 *  would dominate the cost of the short queries this service runs.
 */
import { Pool, PoolClient } from 'pg';

import { config } from '../config';

export const pool = new Pool({ connectionString: config.databaseUrl });

/**
 * Runs `work` inside a transaction, committing on return and rolling back on
 * throw.
 *
 * Several operations here have to be atomic to be correct. Storing a report
 * and advancing its queue entry is the clearest case, and leaving that to
 * the caller invites forgetting it.
 */
export async function withTransaction<T>(work: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
