/** The catalogue the application is installed with.
 *
 *  Written into the device's database on the first start, so somebody who
 *  installs the application has trails to look at before signing in,
 *  before synchronising and before downloading a single tile of map. A
 *  catalogue that only arrives over the network is no catalogue at all for
 *  an application whose whole point is working without one.
 *
 *  It is generated rather than written by hand. There used to be four
 *  trails typed out as waypoints, which was enough to demonstrate the
 *  rules and nothing else. The real ones come from OpenStreetMap, joined
 *  from the fragments they are drawn in, filtered down to what is actually
 *  a walk, and given heights from the same terrain data the contour lines
 *  came from, because OpenStreetMap carries none and without them there is
 *  no profile and no difficulty. See server/src/trails/make-catalogue.ts.
 *
 *  Regenerating it updates the trails rather than duplicating them: the
 *  identifiers are derived from the ways each one was built from, so the
 *  same path keeps the same identity between runs.
 */
import catalogue from './catalogue.json';

import { Point } from '../domain/types';

export interface SeedTrail {
  /** Derived from the source ways, and in the form of a UUID because the
   *  server identifies trails that way. The same trail is therefore the
   *  same record on both sides and a synchronisation updates it instead of
   *  adding a second copy. */
  id: string;
  name: string;
  description: string;
  points: Point[];
}

export const SEED_TRAILS: SeedTrail[] = catalogue.trails as SeedTrail[];

/**
 * Who the trails belong to, which has to travel with them.
 *
 * The Open Database Licence requires attribution of anything derived from
 * OpenStreetMap, and the application shows this wherever the catalogue is.
 */
export const CATALOGUE_ATTRIBUTION = catalogue.attribution;

/** When the catalogue shipped, so a stale one can be recognised. */
export const CATALOGUE_GENERATED = catalogue.generated;
