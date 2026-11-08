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
import { Forecast } from '../domain/types';

/** Where the answer came from, so the screen can say how fresh it is. */
export type ForecastSource = 'upstream' | 'cache' | 'stale';

export interface ForecastDay {
  forecast: Forecast;
  obtainedAt: string;
}

interface ForecastResponse {
  trailId: string;
  days: ForecastDay[];
  source: ForecastSource;
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
  try {
    const response = await requestAuthenticated<ForecastResponse>(
      `/api/trails/${trailId}/forecast`,
    );
    return response.days[0] ?? null;
  } catch {
    return null;
  }
}
