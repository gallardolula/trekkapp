/** Trails preloaded for the prototype demonstration.
 *
 *  Each trail is defined by a handful of waypoints and the full track is
 *  obtained by interpolating between them, so the geometry has the density
 *  the distance to track calculation needs without writing out thousands of
 *  coordinates by hand.
 *
 *  The coordinates correspond to real areas of the Sierras de Córdoba. The
 *  routes are representative and do not replace a track surveyed in the
 *  field, which is what the application lets the hiker import.
 */
import { Point } from '../domain/types';

interface Waypoint {
  lat: number;
  lon: number;
  ele: number;
}

export interface SeedTrail {
  /** Fixed, and in the form of a UUID, because the server identifies trails
   *  that way. The same trail is therefore the same record on both sides and
   *  a synchronisation updates it instead of adding a second copy. */
  id: string;
  name: string;
  description: string;
  waypoints: Waypoint[];
}

/**
 * Densifies a sequence of waypoints.
 *
 * Between each consecutive pair it inserts evenly spaced points and applies a
 * small deterministic lateral offset, so the track is not a run of perfectly
 * straight segments.
 */
export function densify(waypoints: Waypoint[], perLeg = 40): Point[] {
  const points: Point[] = [];
  for (let i = 0; i < waypoints.length - 1; i++) {
    const a = waypoints[i];
    const b = waypoints[i + 1];
    for (let k = 0; k < perLeg; k++) {
      const t = k / perLeg;
      // Deterministic meander, on the order of ten metres.
      const s = Math.sin(t * Math.PI * 3 + i) * 0.00009;
      points.push({
        lat: a.lat + (b.lat - a.lat) * t + s,
        lon: a.lon + (b.lon - a.lon) * t - s,
        ele: a.ele + (b.ele - a.ele) * t,
      });
    }
  }
  const last = waypoints[waypoints.length - 1];
  points.push({ lat: last.lat, lon: last.lon, ele: last.ele });
  return points;
}

export const SEED_TRAILS: SeedTrail[] = [
  {
    id: '7b1f0c2a-0001-4a00-8000-000000000001',
    name: 'Quebrada del Condorito. Balcón Norte',
    description:
      'Recorrido de baja exigencia desde el portal de La Pampilla hasta el Balcón Norte, dentro del Parque Nacional Quebrada del Condorito.',
    waypoints: [
      { lat: -31.6485, lon: -64.6762, ele: 2080 },
      { lat: -31.6531, lon: -64.6894, ele: 2120 },
      { lat: -31.6598, lon: -64.7015, ele: 2165 },
      { lat: -31.6642, lon: -64.7138, ele: 2190 },
      { lat: -31.6671, lon: -64.7224, ele: 2155 },
    ],
  },
  {
    id: '7b1f0c2a-0002-4a00-8000-000000000002',
    name: 'Los Gigantes. Mogote Chico',
    description:
      'Ascenso al Mogote Chico desde el acceso de Los Gigantes, con tramos de roca y sin señalización continua en la parte alta.',
    waypoints: [
      { lat: -31.3962, lon: -64.7883, ele: 1620 },
      { lat: -31.4015, lon: -64.7951, ele: 1790 },
      { lat: -31.4068, lon: -64.8032, ele: 1965 },
      { lat: -31.4114, lon: -64.8097, ele: 2140 },
      { lat: -31.4089, lon: -64.8156, ele: 2280 },
      { lat: -31.4041, lon: -64.8203, ele: 2374 },
    ],
  },
  {
    id: '7b1f0c2a-0003-4a00-8000-000000000003',
    name: 'Cerro Champaquí por Villa Alpina',
    description:
      'Ruta clásica de ascenso al punto más alto de la provincia, de dos jornadas, con vadeo de arroyos y tramos expuestos sobre el filo.',
    waypoints: [
      { lat: -32.0021, lon: -64.8612, ele: 1180 },
      { lat: -31.9968, lon: -64.8754, ele: 1340 },
      { lat: -31.9921, lon: -64.8871, ele: 1585 },
      { lat: -31.9874, lon: -64.8993, ele: 1830 },
      { lat: -31.9842, lon: -64.9108, ele: 2110 },
      { lat: -31.9805, lon: -64.9217, ele: 2390 },
      { lat: -31.9779, lon: -64.9296, ele: 2630 },
      { lat: -31.9754, lon: -64.9341, ele: 2790 },
    ],
  },
  {
    id: '7b1f0c2a-0004-4a00-8000-000000000004',
    name: 'Los Terrones. Circuito de las formaciones',
    description:
      'Circuito corto y señalizado entre formaciones de arenisca, apto para una salida de medio día.',
    waypoints: [
      { lat: -30.9512, lon: -64.5681, ele: 1140 },
      { lat: -30.9548, lon: -64.5724, ele: 1186 },
      { lat: -30.9576, lon: -64.5762, ele: 1218 },
      { lat: -30.9551, lon: -64.5801, ele: 1195 },
      { lat: -30.9516, lon: -64.5759, ele: 1152 },
      { lat: -30.9512, lon: -64.5681, ele: 1140 },
    ],
  },
];
