/** Weather service client.
 *
 *  In the final design the request goes through the server, which keeps a
 *  shared cache and concentrates the configuration. While that component does
 *  not exist, the prototype queries the service directly so the weather rule
 *  can be demonstrated with real data.
 */
import { Forecast } from '../domain/types';

const BASE = 'https://api.open-meteo.com/v1/forecast';

interface OpenMeteoResponse {
  daily?: {
    time?: string[];
    precipitation_sum?: (number | null)[];
    wind_speed_10m_max?: (number | null)[];
    temperature_2m_min?: (number | null)[];
    temperature_2m_max?: (number | null)[];
  };
}

const num = (v: number | null | undefined) => (typeof v === 'number' ? v : 0);

/**
 * Fetches today's forecast for a pair of coordinates.
 *
 * Returns null when the service does not answer or carries no data, because
 * a missing forecast must not block the download but be reported as missing.
 */
export async function fetchForecast(lat: number, lon: number): Promise<Forecast | null> {
  const url =
    `${BASE}?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}` +
    '&daily=precipitation_sum,wind_speed_10m_max,temperature_2m_min,temperature_2m_max' +
    '&timezone=auto&forecast_days=1';

  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const j = (await r.json()) as OpenMeteoResponse;
    const d = j.daily;
    if (!d?.time?.length) return null;
    return {
      date: d.time[0],
      precipitationMm: num(d.precipitation_sum?.[0]),
      windKmh: num(d.wind_speed_10m_max?.[0]),
      minTempC: num(d.temperature_2m_min?.[0]),
      maxTempC: num(d.temperature_2m_max?.[0]),
    };
  } catch {
    return null;
  }
}
