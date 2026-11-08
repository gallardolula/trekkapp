/** Preparing local storage when the application starts.
 *
 *  Opens the database, applies pending migrations and loads the preloaded
 *  catalogue the first time. Loading is idempotent, so restarting the
 *  application neither duplicates trails nor overwrites imported ones.
 */
import { listTrails, openDatabase, saveTrail } from '../data/db';
import { densify, SEED_TRAILS } from './seed';

let preparation: Promise<void> | null = null;

async function prepareOnce(): Promise<void> {
  await openDatabase();
  const existing = await listTrails();
  const ids = new Set(existing.map((t) => t.id));

  for (const t of SEED_TRAILS) {
    if (ids.has(t.id)) continue;
    await saveTrail({
      id: t.id,
      name: t.name,
      description: t.description,
      points: densify(t.waypoints),
      source: 'preloaded',
    });
  }
}

/** Ensures the database is ready. Safe to call as often as needed. */
export function prepareStorage(): Promise<void> {
  if (!preparation) {
    preparation = prepareOnce().catch((e) => {
      preparation = null; // allows a retry when preparation failed
      throw e;
    });
  }
  return preparation;
}
