/** Weather for a trail.
 *
 *  The request goes to the server and not to the provider. The server asks
 *  once per trail and per freshness window rather than once per device,
 *  and it asks about the trail's own coordinates, taken from its geometry,
 *  instead of whatever a device happens to send. See docs/adr/0007.
 *
 *  Nothing here decides anything. The thresholds that turn a forecast into
 *  a warning live in the domain, which is what keeps the provider
 *  replaceable without touching a rule.
 */
import { requestAuthenticated } from './api';
import { Forecast, HourlyForecast } from '../domain/types';

/** Where the answer came from, so the screen can say how fresh it is. */
export type ForecastSource = 'upstream' | 'cache' | 'stale';

export interface ForecastDay {
  forecast: Forecast;
  obtainedAt: string;
}

interface ForecastResponse {
  trailId: string;
  days: ForecastDay[];
  hourly?: HourlyForecast[];
  source: ForecastSource;
}

export interface TrailWeather {
  today: ForecastDay | null;
  /** The hours still ahead, which is all anybody reads them for. */
  hours: HourlyForecast[];
}

/**
 * Fetches the forecast of a trail, or null when it cannot be obtained.
 *
 * Null covers every reason indistinguishably on purpose. Whether there is
 * no coverage, no session, or the provider is down, the consequence is the
 * same: the screen shows whatever it has stored, with its age, and the
 * download is never blocked by a forecast nobody could read.
 */
export async function fetchForecast(trailId: string): Promise<ForecastDay | null> {
  return (await fetchWeather(trailId)).today;
}

/**
 * The day and the hours ahead of it.
 *
 * Past hours are dropped here rather than on screen. A forecast for nine
 * in the morning read at noon is not information, it is clutter sitting
 * where the next few hours should be.
 */
export async function fetchWeather(trailId: string): Promise<TrailWeather> {
  try {
    const response = await requestAuthenticated<ForecastResponse>(
      `/api/trails/${trailId}/forecast`,
    );
    const now = Date.now();
    return {
      today: response.days[0] ?? null,
      hours: (response.hourly ?? [])
        .filter((h) => new Date(h.time).getTime() >= now - 30 * 60_000)
        .slice(0, 12),
    };
  } catch {
    return { today: null, hours: [] };
  }
}
