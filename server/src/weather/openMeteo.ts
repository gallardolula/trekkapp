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

const BASE = 'https://api.open-meteo.com/v1/forecast';
const TIMEOUT_MS = 8_000;

interface OpenMeteoResponse {
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
): Promise<Forecast[]> {
  const url =
    `${BASE}?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}` +
    '&daily=precipitation_sum,wind_speed_10m_max,temperature_2m_min,temperature_2m_max' +
    `&timezone=auto&forecast_days=${days}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return [];
    const body = (await response.json()) as OpenMeteoResponse;
    const daily = body.daily;
    if (!daily?.time?.length) return [];

    return daily.time.map((date, i) => ({
      date,
      precipitationMm: num(daily.precipitation_sum?.[i]),
      windKmh: num(daily.wind_speed_10m_max?.[i]),
      minTempC: num(daily.temperature_2m_min?.[i]),
      maxTempC: num(daily.temperature_2m_max?.[i]),
    }));
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}
