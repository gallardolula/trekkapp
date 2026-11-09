/** Business rules engine.
 *
 *  Four rules, all pure and all executable without connectivity:
 *    1. whether a hiker may take on a trail given the level they declared,
 *    2. whether they are close enough to the trail to be setting out on it,
 *    3. whether their current position amounts to a deviation from the track,
 *    4. whether the trail's forecast represents a risk.
 *
 *  Depending on neither the database nor the network, they can be tested in
 *  isolation and they behave in the field exactly as they do under test.
 */
import { distanceToTrack } from './geo';
import {
  DeviationState,
  AttemptDecision,
  Forecast,
  INITIAL_DEVIATION_STATE,
  Level,
  LEVEL_ORDER,
  Point,
  Severity,
  TrailAttributes,
  WeatherAlert,
} from './types';

// ----------------------------------------------------------------- level --

const LEVEL_LABEL: Record<Level, string> = {
  beginner: 'principiante',
  intermediate: 'intermedio',
  advanced: 'avanzado',
};

/**
 * Decides whether somebody may take on a trail, given what they declared.
 *
 * Never a refusal: the final call stays with the person, who knows things
 * about themselves the application does not. What changes is that a trail
 * harder than the level they declared asks for an explicit confirmation
 * instead of letting them set out without one.
 *
 * This used to gate the download, which is why somebody could open a trail
 * beyond their level, skip marking it, and start walking without ever
 * being asked. The gate belongs on setting out.
 */
export function evaluateAttempt(
  attributes: TrailAttributes,
  hikerLevel: Level,
): AttemptDecision {
  const gap = LEVEL_ORDER[attributes.difficulty] - LEVEL_ORDER[hikerLevel];

  if (gap <= 0) return { allowed: true, requiresConfirmation: false };

  const km = (attributes.distanceM / 1000).toFixed(1);
  const gain = Math.round(attributes.elevationGainM);
  const reason =
    `Este sendero está clasificado como ${LEVEL_LABEL[attributes.difficulty]} ` +
    `(${km} km y ${gain} m de desnivel acumulado) y tu nivel declarado es ` +
    `${LEVEL_LABEL[hikerLevel]}.`;

  return { allowed: true, requiresConfirmation: true, reason };
}

// --------------------------------------------------------------- deviation --

/** Default tolerance radius, in metres. */
export const TOLERANCE_RADIUS_M = 50;

/**
 * Consecutive readings beyond the radius needed to raise the alert.
 *
 * One reading is not enough: receiver error under tree cover or inside a
 * gorge can exceed 30 metres on a single fix.
 */
export const READINGS_TO_OPEN = 3;

/** Consecutive readings inside the re-entry radius needed to clear it. */
export const READINGS_TO_CLOSE = 3;

/**
 * Fraction of the radius that must be regained to clear the alert.
 *
 * Clearing at the same threshold that opens it would make the alert flicker
 * while the hiker walks along the boundary. Requiring a return to 70 % of the
 * radius introduces the hysteresis that prevents that behaviour.
 */
export const REENTRY_FACTOR = 0.7;

export interface DeviationResult {
  state: DeviationState;
  /** True only on the reading that opens the alert, so it is not repeated. */
  shouldAlert: boolean;
  /** True only on the reading that clears it. */
  shouldClearAlert: boolean;
}

/**
 * Evaluates one position reading against the previous tracking state.
 *
 * A pure function: it takes the former state and returns the next one, so the
 * alert logic depends on no global variable and on no notion of when it runs.
 */
export function evaluateDeviation(
  distanceToTrackM: number,
  previous: DeviationState = INITIAL_DEVIATION_STATE,
  radiusM: number = TOLERANCE_RADIUS_M,
): DeviationResult {
  const outside = distanceToTrackM > radiusM;
  const withinReentry = distanceToTrackM <= radiusM * REENTRY_FACTOR;

  if (!previous.offTrack) {
    const readingsOutside = outside ? previous.readingsOutside + 1 : 0;
    const opens = readingsOutside >= READINGS_TO_OPEN;
    return {
      state: {
        offTrack: opens,
        readingsOutside: opens ? 0 : readingsOutside,
        readingsInside: 0,
      },
      shouldAlert: opens,
      shouldClearAlert: false,
    };
  }

  const readingsInside = withinReentry ? previous.readingsInside + 1 : 0;
  const closes = readingsInside >= READINGS_TO_CLOSE;
  return {
    state: {
      offTrack: !closes,
      readingsOutside: 0,
      readingsInside: closes ? 0 : readingsInside,
    },
    shouldAlert: false,
    shouldClearAlert: closes,
  };
}

// ----------------------------------------------------------------- weather --

export interface WeatherThresholds {
  precipitationMm: number;
  windKmh: number;
  minTempC: number;
}

/** Default thresholds for a day hike in the mountains. */
export const WEATHER_THRESHOLDS: WeatherThresholds = {
  precipitationMm: 10,
  windKmh: 40,
  minTempC: 0,
};

/** Multiplier beyond which a condition turns from warning into risk. */
export const RISK_FACTOR = 2;

/**
 * Evaluates the trail's forecast against the defined thresholds.
 *
 * Returns the highest severity reached together with every condition that
 * caused it, so the warning can explain itself instead of merely stating that
 * a risk exists.
 */
export function evaluateWeather(
  forecast: Forecast,
  thresholds: WeatherThresholds = WEATHER_THRESHOLDS,
  now: Date = new Date(),
): WeatherAlert {
  const reasons: string[] = [];
  let severity: Severity = 'none';

  const raise = (next: Severity) => {
    if (next === 'risk' || severity === 'none') severity = next;
  };

  if (forecast.precipitationMm >= thresholds.precipitationMm) {
    const severe = forecast.precipitationMm >= thresholds.precipitationMm * RISK_FACTOR;
    reasons.push(`Precipitación prevista de ${forecast.precipitationMm} mm.`);
    raise(severe ? 'risk' : 'warning');
  }

  if (forecast.windKmh >= thresholds.windKmh) {
    const severe = forecast.windKmh >= thresholds.windKmh * RISK_FACTOR;
    reasons.push(`Viento previsto de ${forecast.windKmh} km/h.`);
    raise(severe ? 'risk' : 'warning');
  }

  if (forecast.minTempC <= thresholds.minTempC) {
    const severe = forecast.minTempC <= thresholds.minTempC - 5;
    reasons.push(`Temperatura mínima prevista de ${forecast.minTempC} °C.`);
    raise(severe ? 'risk' : 'warning');
  }

  return { severity, reasons, evaluatedAt: now.toISOString() };
}

// ----------------------------------------------------------- setting out --

/**
 * How far from the path somebody may be and still be setting out on it.
 *
 * Generous on purpose. A trailhead car park sits off the recorded line, an
 * approach road runs parallel for a while, and a satellite fix under tree
 * cover wanders. Two kilometres covers all of that and still rules out
 * what this exists to rule out, which is starting a walk from a sofa in
 * another city and having the application record it as a hike.
 */
export const START_RADIUS_M = 2000;

export interface StartDecision {
  allowed: boolean;
  /** Metres to the nearest point of the track, when it could be measured. */
  distanceM: number | null;
  reason?: string;
}

/**
 * Decides whether a walk can begin from where the hiker is standing.
 *
 * Unlike the level rule this one does refuse, and the difference is worth
 * stating. The level rule weighs something the person knows better than
 * the application does, so it asks. This one weighs a fact, which is
 * whether they are at the trail, and a recording made from somewhere else
 * is not a cautious decision but a wrong one: it would enter the history
 * as a walk, count towards the distance they have covered, and anchor any
 * report they wrote to a path they were never on.
 *
 * A null position is not a refusal. It means the receiver has not answered
 * yet, which is ordinary in a valley and under trees, and the caller is
 * expected to wait rather than to decide.
 */
export function evaluateStart(position: Point | null, track: Point[]): StartDecision {
  if (track.length === 0) {
    return { allowed: false, distanceM: null, reason: 'Este sendero no tiene traza descargada.' };
  }
  if (!position) {
    return {
      allowed: false,
      distanceM: null,
      reason: 'Todavía no hay lectura del receptor. Esperá a que el teléfono te ubique.',
    };
  }

  const { meters } = distanceToTrack(position, track);
  if (meters <= START_RADIUS_M) return { allowed: true, distanceM: meters };

  const away =
    meters >= 10_000
      ? `${Math.round(meters / 1000)} km`
      : `${(meters / 1000).toFixed(1)} km`;

  return {
    allowed: false,
    distanceM: meters,
    reason:
      `Estás a ${away} del sendero. El recorrido se inicia cuando llegás, ` +
      'para que lo que quede registrado sea lo que caminaste de verdad.',
  };
}
