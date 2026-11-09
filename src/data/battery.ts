/** Reading the battery, and keeping what was read.
 *
 *  RNF04 commits to no more than ten per cent an hour with the screen off,
 *  and that figure was never measured. It cannot be measured on a desk: it
 *  needs a real device, a real walk and real time, which is exactly why a
 *  requirement like this tends to stay a claim. This is the instrument that
 *  turns it into a number.
 *
 *  A session is started, the phone is locked and carried, and the session
 *  is stopped on return. Samples are taken whenever the application is
 *  awake and are written to the device database, so a locked screen costs
 *  resolution and not the measurement: the first and last readings give the
 *  rate, and the ones between show whether the drain was even.
 *
 *  What the readings mean is decided in src/domain/battery.ts, which has no
 *  device in it and can therefore be tested.
 */
import { rateOf, type Rate, type Sample } from '../domain/battery';
import { openDatabase } from './db';

export { rateOf, RNF04_BUDGET_PER_HOUR } from '../domain/battery';
export type { Sample } from '../domain/battery';

/** The module is absent from a build without it, as the camera is. */
const battery: typeof import('expo-battery') | null = (() => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-battery') as typeof import('expo-battery');
  } catch {
    return null;
  }
})();

/** Whether this build can read the battery at all. */
export const batteryAvailable = () => battery !== null;

export interface SessionResult extends Rate {
  session: string;
  samples: Sample[];
}

/** Reads the battery, or null where the module is absent. */
export async function read(): Promise<Sample | null> {
  if (!battery) return null;
  const level = await battery.getBatteryLevelAsync();
  const state = await battery.getBatteryStateAsync();
  return {
    // The module reports 0 to 1, and a percentage is what the requirement
    // is written in.
    level: Math.round(level * 1000) / 10,
    charging: state === battery.BatteryState.CHARGING || state === battery.BatteryState.FULL,
    at: new Date().toISOString(),
  };
}

/** Takes a reading and records it against a session. */
export async function sample(session: string): Promise<Sample | null> {
  const s = await read();
  if (!s) return null;
  const db = await openDatabase();
  await db.runAsync(
    'INSERT INTO battery_samples (session, level, charging, at) VALUES (?, ?, ?, ?)',
    session,
    s.level,
    s.charging ? 1 : 0,
    s.at,
  );
  return s;
}

/** Starts a session and takes its first reading. */
export async function startSession(): Promise<string | null> {
  if (!battery) return null;
  const session = `m-${Date.now()}`;
  const first = await sample(session);
  return first ? session : null;
}

/** Everything recorded for a session, oldest first. */
export async function samplesOf(session: string): Promise<Sample[]> {
  const db = await openDatabase();
  const rows = await db.getAllAsync<{ level: number; charging: number; at: string }>(
    'SELECT level, charging, at FROM battery_samples WHERE session = ? ORDER BY at',
    session,
  );
  return rows.map((r) => ({ level: r.level, charging: r.charging === 1, at: r.at }));
}

/** A finished session, with its reading and its verdict. */
export async function resultOf(session: string): Promise<SessionResult> {
  const samples = await samplesOf(session);
  return { session, samples, ...rateOf(samples) };
}

/** Every session recorded on this device, newest first. */
export async function listSessions(): Promise<{ session: string; started: string; count: number }[]> {
  const db = await openDatabase();
  return db.getAllAsync<{ session: string; started: string; count: number }>(
    `SELECT session, MIN(at) AS started, COUNT(*) AS count
       FROM battery_samples GROUP BY session ORDER BY started DESC`,
  );
}

/** Forgets a session, for a measurement that was spoiled. */
export async function forgetSession(session: string): Promise<void> {
  const db = await openDatabase();
  await db.runAsync('DELETE FROM battery_samples WHERE session = ?', session);
}
