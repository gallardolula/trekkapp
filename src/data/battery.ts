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

/**
 * The module, or the reason it could not be loaded.
 *
 * It asks for its native counterpart the moment it is imported, so a host
 * application that does not carry that counterpart fails here rather than
 * on the first call. The reason is kept: 'absent' and 'present but broken'
 * look identical from the outside, and a screen that reports only the first
 * sends somebody looking in the wrong place.
 */
const loaded: { module: typeof import('expo-battery') | null; reason: string | null } = (() => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return { module: require('expo-battery') as typeof import('expo-battery'), reason: null };
  } catch (error) {
    return { module: null, reason: (error as Error).message };
  }
})();

const battery = loaded.module;

/** Whether this build can read the battery at all. */
export const batteryAvailable = () => battery !== null;

/** Why it cannot, when it cannot. */
export const batteryUnavailableReason = () => loaded.reason;

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

/**
 * Takes a reading and records it against a session.
 *
 * A level given by hand is used when there is one, and the module is asked
 * otherwise. Expo Go does not carry the native counterpart, so on the
 * client this prototype is tested with there is nothing to ask; the figure
 * the requirement needs is two percentages and the time between them, and
 * the indicator the phone already shows is a perfectly good instrument for
 * that. The arithmetic does not care where the number came from.
 */
export async function sample(session: string, level?: number): Promise<Sample | null> {
  const s =
    level === undefined
      ? await read()
      : { level: Math.max(0, Math.min(100, level)), charging: false, at: new Date().toISOString() };
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
export async function startSession(level?: number): Promise<string | null> {
  if (!battery && level === undefined) return null;
  const session = `m-${Date.now()}`;
  const first = await sample(session, level);
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
