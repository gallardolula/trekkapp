/** When the application synchronises on its own.
 *
 *  Synchronising is still never a background activity and never happens
 *  during a walk. What changed is that it no longer has to be asked for
 *  every time: when the application comes to the front and the server
 *  answers, it runs.
 *
 *  That is a refinement of the decision in docs/adr/0004 and not a reversal
 *  of it. What that decision protects against is a phone hunting for signal
 *  on a mountain, spending the one resource that cannot be replaced in the
 *  field on information nobody is waiting for. Coming to the front is an
 *  event the platform hands over for free, it happens when somebody is
 *  holding the phone and looking at it, and it is exactly the moment a
 *  report that has been waiting in the queue should leave.
 *
 *  There is no polling here. Asking the network every so often whether it
 *  is back is the very thing the decision rules out, and it is also the
 *  wrong question: what matters is whether this server answers, not whether
 *  the radio is on.
 */
import { AppState, type AppStateStatus } from 'react-native';

import { serverReachable } from '../data/api';
import { countPendingSync } from '../data/db';
import { hasSession } from '../data/session';
import { NotAuthenticatedError, synchronise, type SyncResult } from './engine';

/** How long before the same trigger is allowed to run again. */
const MIN_INTERVAL_MS = 5 * 60_000;

/** Why a run did not happen, which is most of the time. */
export type Skipped =
  | 'recording'
  | 'already-running'
  | 'too-soon'
  | 'no-session'
  | 'unreachable';

export type AutoSyncOutcome = { ran: true; result: SyncResult } | { ran: false; why: Skipped };

interface State {
  recording: boolean;
  running: boolean;
  lastAttempt: number;
}

const state: State = { recording: false, running: false, lastAttempt: 0 };

/**
 * Declares that a walk is being recorded, or is over.
 *
 * Held in memory and not read from the database on purpose. An application
 * that was killed mid-walk leaves an unfinished row behind, and a fresh
 * process is recording nothing whatever that row says. Asking the database
 * would let one crash disable synchronisation for good.
 */
export function setRecording(on: boolean): void {
  state.recording = on;
}

/** Forgets the interval, so the next trigger runs. Used when signing in. */
export function allowImmediateSync(): void {
  state.lastAttempt = 0;
}

/**
 * Runs a synchronisation if this is a good moment, and says what happened.
 *
 * Every refusal has a name rather than being a silent false, because the
 * difference between "there is no session" and "the server did not answer"
 * is the difference between asking somebody to sign in and saying nothing
 * at all.
 */
export async function syncIfConnected(now = Date.now()): Promise<AutoSyncOutcome> {
  if (state.recording) return { ran: false, why: 'recording' };
  if (state.running) return { ran: false, why: 'already-running' };
  if (now - state.lastAttempt < MIN_INTERVAL_MS) return { ran: false, why: 'too-soon' };

  // Claimed here, before anything is awaited. Taken after the first await
  // instead, two triggers arriving close together both get past the guard
  // while the first is still suspended, and the device runs two
  // synchronisations over the same queue.
  state.running = true;
  try {
    // Checked before the network, because it needs no network. Somebody
    // who signed out should not have their phone reaching for the server.
    if (!(await hasSession())) return { ran: false, why: 'no-session' };

    // Then the cheap question. A phone with no coverage answers in
    // milliseconds and the synchronisation never starts.
    if (!(await serverReachable())) return { ran: false, why: 'unreachable' };

    state.lastAttempt = now;
    return { ran: true, result: await synchronise() };
  } finally {
    state.running = false;
  }
}

/**
 * Synchronises whenever the application comes to the front.
 *
 * Returns the function that stops watching, which the caller is expected
 * to keep: a second subscription would synchronise twice on every
 * transition.
 */
export function syncOnForeground(
  report: (outcome: AutoSyncOutcome) => void = () => undefined,
): () => void {
  const subscription = AppState.addEventListener('change', (next: AppStateStatus) => {
    if (next !== 'active') return;
    void run(report);
  });

  // The first transition into the foreground is the launch itself, which
  // emits no event.
  void run(report);

  return () => subscription.remove();
}

async function run(report: (outcome: AutoSyncOutcome) => void): Promise<void> {
  try {
    report(await syncIfConnected());
  } catch (error) {
    // A session that expired while the phone was away is the one failure
    // worth passing on; the rest is a synchronisation that did not happen,
    // which is the ordinary state of an application used offline.
    if (error instanceof NotAuthenticatedError) report({ ran: false, why: 'no-session' });
  }
}

/** How many reports are still waiting, for a screen that wants to say so. */
export async function pendingCount(): Promise<number> {
  return countPendingSync();
}
