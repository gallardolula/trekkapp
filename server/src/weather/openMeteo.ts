/** Client for the upstream weather service.
 *
 *  The only place that knows this provider exists. Everything else works
 *  against the Forecast shape, which is what makes the provider
 *  replaceable: the thresholds that turn a forecast into a warning live in
 *  the domain, not here.
 */
export interface Forecast {
  date: string;
  precipitationMm: number;
  windKmh: number;
  minTempC: number;
  maxTempC: number;
}

/**
 * One hour of the forecast.
 *
 * A day's minimum and maximum say whether to go. The hours say when to
 * leave and when to be off the ridge, which on a mountain is the decision
 * somebody actually makes.
 */
export interface HourlyForecast {
  time: string;
  tempC: number;
  rainChance: number;
  windKmh: number;
}

export interface Weather {
  daily: Forecast[];
  hourly: HourlyForecast[];
}

/** Nothing, which every failure here returns rather than throwing. */
const EMPTY: Weather = { daily: [], hourly: [] };

const BASE = 'https://api.open-meteo.com/v1/forecast';
const TIMEOUT_MS = 8_000;

interface OpenMeteoResponse {
  hourly?: {
    time?: string[];
    temperature_2m?: number[];
    precipitation_probability?: number[];
    wind_speed_10m?: number[];
  };
  daily?: {
    time?: string[];
    precipitation_sum?: (number | null)[];
    wind_speed_10m_max?: (number | null)[];
    temperature_2m_min?: (number | null)[];
    temperature_2m_max?: (number | null)[];
  };
}

// A missing value is read as zero rather than discarding the whole day.
// The provider omits a field it has no data for, and the remaining three
// are still worth evaluating.
const num = (v: number | null | undefined) => (typeof v === 'number' ? v : 0);

/**
 * Fetches the coming days for a pair of coordinates.
 *
 * Returns an empty list rather than throwing when the provider does not
 * answer. A forecast that cannot be obtained must be reported as missing,
 * never block the decision, and never be confused with good weather.
 */
export async function fetchForecast(
  lat: number,
  lon: number,
  days = 3,
): Promise<Weather> {
  const url =
    `${BASE}?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}` +
    '&daily=precipitation_sum,wind_speed_10m_max,temperature_2m_min,temperature_2m_max' +
    '&hourly=temperature_2m,precipitation_probability,wind_speed_10m' +
    `&timezone=auto&forecast_days=${days}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return EMPTY;
    const body = (await response.json()) as OpenMeteoResponse;
    const daily = body.daily;
    if (!daily?.time?.length) return EMPTY;

    const hourly = body.hourly;
    return {
      daily: daily.time.map((date, i) => ({
        date,
        precipitationMm: num(daily.precipitation_sum?.[i]),
        windKmh: num(daily.wind_speed_10m_max?.[i]),
        minTempC: num(daily.temperature_2m_min?.[i]),
        maxTempC: num(daily.temperature_2m_max?.[i]),
      })),
      // Absent is not an error. The daily figures are what the warnings
      // are weighed against, and the hours are what somebody reads.
      hourly: (hourly?.time ?? []).map((time, i) => ({
        time,
        tempC: num(hourly?.temperature_2m?.[i]),
        rainChance: num(hourly?.precipitation_probability?.[i]),
        windKmh: num(hourly?.wind_speed_10m?.[i]),
      })),
    };
  } catch {
    return EMPTY;
  } finally {
    clearTimeout(timer);
  }
}
