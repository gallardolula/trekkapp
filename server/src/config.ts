/** Configuration read from the environment.
 *
 *  Everything the server needs to run is resolved once, at start-up, and a
 *  missing value stops the process instead of surfacing as a confusing
 *  failure on the first request that needs it.
 */

import { join } from 'node:path';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`missing environment variable ${name}`);
  return value;
}

function number(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) throw new Error(`environment variable ${name} is not a number`);
  return parsed;
}

export const config = {
  databaseUrl: required('DATABASE_URL'),
  port: number('PORT', 3000),
  host: process.env.HOST ?? '127.0.0.1',
  jwtSecret: required('JWT_SECRET'),
  accessTokenMinutes: number('ACCESS_TOKEN_MINUTES', 15),
  refreshTokenDays: number('REFRESH_TOKEN_DAYS', 30),
  // Where the generated tile archives live. They are build artefacts, kept
  // outside the server so that regenerating them does not touch its code.
  tilesDir: process.env['TILES_DIR'] ?? join(__dirname, '..', '..', 'tiles', 'out'),
} as const;
