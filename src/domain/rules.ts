/** Business rules engine.
 *
 *  Three rules, all pure and all executable without connectivity:
 *    1. whether a hiker may download a trail given the level they declared,
 *    2. whether their current position amounts to a deviation from the track,
 *    3. whether the trail's forecast represents a risk.
 *
 *  Depending on neither the database nor the network, they can be tested in
 *  isolation and they behave in the field exactly as they do under test.
 */
import {
  DeviationState,
  DownloadDecision,
  Forecast,
  INITIAL_DEVIATION_STATE,
  Level,
  LEVEL_ORDER,
  Severity,
  TrailAttributes,
  WeatherAlert,
} from './types';

// ---------------------------------------------------------------- download --

const LEVEL_LABEL: Record<Level, string> = {
  beginner: 'principiante',
  intermediate: 'intermedio',
  advanced: 'avanzado',
};

/**
 * Decides whether a hiker may download a trail.
 *
 * The download is never blocked: the final call stays with the person. What
 * changes is that when the trail's difficulty exceeds the declared level, an
 * explicit confirmation is required instead of downloading silently.
 */
export function evaluateDownload(
  attributes: TrailAttributes,
  hikerLevel: Level,
): DownloadDecision {
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
