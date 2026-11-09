/** Loads the catalogue the prototype ships with.
 *
 *  The trails come from the application's own catalogue module, imported
 *  rather than copied, so the device and the server describe the same
 *  routes under the same identifiers. A second definition would drift, and
 *  the first symptom would be the same trail appearing twice on a phone
 *  after synchronising.
 *
 *  The server needs them for its own sake and not only for the device.
 *  Everything it keeps about a trail hangs off this row: a report cites it,
 *  a forecast is cached against it, and both are refused for a trail the
 *  server does not hold. A phone showing a catalogue the server never
 *  received therefore has trails whose weather and reports cannot work, so
 *  this runs after every catalogue is generated and not only at install.
 *
 *  Idempotent: running it again updates the rows instead of adding more.
 *
 *  Usage: npm run seed
 */
import { computeAttributes } from '../../../src/domain/trail';
import { SEED_TRAILS } from '../../../src/startup/seed';
import { pool, withTransaction } from './pool';

async function run(): Promise<void> {
  for (const trail of SEED_TRAILS) {
    const points = trail.points;
    // Derived here from the geometry, as for any other trail. The server
    // does not take these from anywhere, not even from its own seed.
    const attributes = computeAttributes(points);

    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO trails
           (id, name, description, distance_m, elevation_gain_m, effort_index,
            difficulty, status, owner_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'published', NULL)
         ON CONFLICT (id) DO UPDATE SET
           name = excluded.name,
           description = excluded.description,
           distance_m = excluded.distance_m,
           elevation_gain_m = excluded.elevation_gain_m,
           effort_index = excluded.effort_index,
           difficulty = excluded.difficulty,
           status = excluded.status`,
        [
          trail.id,
          trail.name,
          trail.description,
          attributes.distanceM,
          attributes.elevationGainM,
          attributes.effortIndex,
          attributes.difficulty,
        ],
      );

      await client.query('DELETE FROM track_points WHERE trail_id = $1', [trail.id]);
      const values: unknown[] = [];
      const tuples = points.map((p, i) => {
        const base = i * 5;
        values.push(trail.id, i, p.lat, p.lon, p.ele ?? null);
        return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`;
      });
      await client.query(
        `INSERT INTO track_points (trail_id, position, lat, lon, ele) VALUES ${tuples.join(', ')}`,
        values,
      );
    });

    console.log(`  ${trail.name} (${points.length} puntos)`);
  }

  console.log(`${SEED_TRAILS.length} senderos en el catálogo`);
  await pool.end();
}

run().catch((error) => {
  console.error('seeding failed:', error.message);
  process.exit(1);
});
