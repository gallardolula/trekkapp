/** Domain types for TrekkApp.
 *
 *  Internal identifiers and enum values are in English. The labels shown to
 *  the hiker are in Spanish and live in the presentation layer, so that the
 *  wording can change without touching the rules.
 */

/** A point on a trail track. Elevation may be missing: not every GPX has it. */
export interface Point {
  lat: number;
  lon: number;
  /** Metres above sea level. */
  ele?: number;
  /** ISO 8601 timestamp, when the source file records one. */
  time?: string;
}

/** Experience level declared by the hiker and, on the same scale, the
 *  difficulty computed for a trail. Sharing the scale is what allows the
 *  rules engine to compare them. */
export type Level = 'beginner' | 'intermediate' | 'advanced';

export const LEVEL_ORDER: Record<Level, number> = {
  beginner: 0,
  intermediate: 1,
  advanced: 2,
};

/** Attributes derived from the track, never supplied by the caller. */
export interface TrailAttributes {
  distanceM: number;
  elevationGainM: number;
  /** Flat equivalent distance in kilometres. See `effortIndex`. */
  effortIndex: number;
  difficulty: Level;
}

/**
 * Where a trail stands.
 *
 * `local` is a trail that exists only on the phone that imported it, and is
 * the one state the server never stores. `withdrawn` is one that was in the
 * shared catalogue and was taken out of it.
 *
 * There used to be a `pending_review` instead, for a trail waiting on a
 * moderator. Nobody could hold that role and nothing could leave that
 * state, and a review of a track on a screen could not establish what
 * mattered anyway. The system validates a contribution and publishes or
 * refuses it now, so the waiting state describes a process that no longer
 * exists. See server/src/trails/validation.ts.
 */
export type TrailStatus = 'published' | 'withdrawn' | 'local';

export interface Trail {
  id: string;
  name: string;
  description?: string;
  points: Point[];
  attributes: TrailAttributes;
  status: TrailStatus;
}

/**
 * Whether somebody may take on a trail, given the level they declared.
 *
 * Named for the attempt and not for the download, because the download was
 * never what it was about. The gap between a trail's difficulty and what
 * somebody says they walk matters at the moment they set out, and marking
 * a trail for offline use is not that moment.
 */
export interface AttemptDecision {
  allowed: boolean;
  requiresConfirmation: boolean;
  reason?: string;
}

/** Deviation tracking state during a hike. The caller keeps this value
 *  between readings; the rules engine itself stays pure. */
export interface DeviationState {
  offTrack: boolean;
  /** Consecutive readings beyond the radius, so a single one cannot fire. */
  readingsOutside: number;
  /** Consecutive readings within the re-entry radius, to clear the alert. */
  readingsInside: number;
}

export const INITIAL_DEVIATION_STATE: DeviationState = {
  offTrack: false,
  readingsOutside: 0,
  readingsInside: 0,
};

/** Forecast for a trail's coordinates, once normalised. */
export interface Forecast {
  date: string;
  precipitationMm: number;
  windKmh: number;
  minTempC: number;
  maxTempC: number;
}

export type Severity = 'none' | 'warning' | 'risk';

export interface WeatherAlert {
  severity: Severity;
  reasons: string[];
  /** When it was evaluated, so its age can be shown offline. */
  evaluatedAt: string;
}
