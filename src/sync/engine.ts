/** Synchronisation with the server.
 *
 *  Runs only when the hiker asks for it. The walk itself never needs the
 *  network, so a background sync would spend battery on the one resource
 *  that cannot be replaced in the field, for information nobody is waiting
 *  on. See docs/adr/0004.
 *
 *  The order is deliberate. What the device produced goes up first, because
 *  a pending report is the only piece of information that exists in a
 *  single place. Only then does the catalogue come down.
 *
 *  Every step is written so that an interruption leaves the device in a
 *  state the next run can continue from. Partial synchronisation is a valid
 *  outcome and is reported as one, not treated as a failure.
 */
import {
  confirmReportsSent,
  countPendingSync,
  listPendingReports,
  readSyncState,
  recordSyncFailure,
  saveRemoteReport,
  saveRemoteTrail,
  saveSyncState,
  saveTrackPoints,
  countTrackPoints,
  trailExists,
  type RemoteReport,
  type RemoteTrail,
} from '../data/db';
import { NotAuthenticatedError, requestAuthenticated } from '../data/api';
import type { Point } from '../domain/types';

export const TRAIL_CURSOR = 'cursor.trails';
export const REPORT_CURSOR = 'cursor.reports';

export interface SyncResult {
  reportsSent: number;
  reportsRejected: number;
  trailsReceived: number;
  tracksDownloaded: number;
  reportsReceived: number;
  /** False when a page remained, so the caller knows to offer another run. */
  complete: boolean;
  pendingAfter: number;
}

interface TrailsPage {
  trails: RemoteTrail[];
  deleted: string[];
  cursor: string | null;
  complete: boolean;
}

interface ReportsPage {
  // The server marks which rows belong to the caller. The device cannot
  // tell, because a report of its own that was accepted comes back looking
  // exactly like anybody else's.
  reports: (RemoteReport & { own: boolean })[];
  cursor: string | null;
  complete: boolean;
}

interface UploadResult {
  accepted: string[];
  rejected: { id: string; reason: string }[];
}

/**
 * Runs one synchronisation.
 *
 * Throws `NotAuthenticatedError` when there is no usable session, which the
 * caller turns into a prompt to sign in. Any other failure propagates with
 * whatever was already committed left in place.
 */
export async function synchronise(): Promise<SyncResult> {
  const result: SyncResult = {
    reportsSent: 0,
    reportsRejected: 0,
    trailsReceived: 0,
    tracksDownloaded: 0,
    reportsReceived: 0,
    complete: true,
    pendingAfter: 0,
  };

  await pushReports(result);
  await pullTrails(result);
  await pullReports(result);

  result.pendingAfter = await countPendingSync();
  return result;
}

/** Sends the queued reports. */
async function pushReports(result: SyncResult): Promise<void> {
  const pending = await listPendingReports();
  if (pending.length === 0) return;

  const response = await requestAuthenticated<UploadResult>('/api/reports', {
    method: 'POST',
    body: { reports: pending },
  });

  // Confirmed only on an explicit acceptance. A report the server did not
  // name stays in the queue, which is the whole point of keeping one.
  await confirmReportsSent(response.accepted);
  result.reportsSent = response.accepted.length;
  result.reportsRejected = response.rejected.length;

  for (const rejection of response.rejected) {
    await recordSyncFailure(rejection.id, rejection.reason);
  }

  if (pending.length === 100) result.complete = false;
}

/**
 * Brings down the catalogue.
 *
 * The cursor advances only after the page it accounts for is stored, so an
 * interruption repeats a page rather than skipping one. Repeating is
 * harmless because every write is an upsert.
 */
async function pullTrails(result: SyncResult): Promise<void> {
  const since = await readSyncState(TRAIL_CURSOR);
  const page = await requestAuthenticated<TrailsPage>(
    `/api/trails${since ? `?since=${encodeURIComponent(since)}` : ''}`,
  );

  for (const trail of page.trails) {
    await saveRemoteTrail(trail);
    result.trailsReceived++;

    // The geometry is a separate and much larger request, so it is fetched
    // only when the device has none. A trail whose track changed arrives
    // with a new cursor value and is refetched by the same rule.
    if ((await countTrackPoints(trail.id)) === 0) {
      const track = await requestAuthenticated<{ points: Point[] }>(
        `/api/trails/${trail.id}/track`,
      );
      await saveTrackPoints(trail.id, track.points);
      result.tracksDownloaded++;
    }
  }

  if (page.cursor) await saveSyncState(TRAIL_CURSOR, page.cursor);
  if (!page.complete) result.complete = false;
}

/** Brings down the reports of published trails. */
async function pullReports(result: SyncResult): Promise<void> {
  const since = await readSyncState(REPORT_CURSOR);
  const page = await requestAuthenticated<ReportsPage>(
    `/api/reports${since ? `?since=${encodeURIComponent(since)}` : ''}`,
  );

  for (const report of page.reports) {
    // A report whose trail is not on the device would violate the foreign
    // key. It arrives on a later run, once its trail does.
    if (!(await trailExists(report.trailId))) continue;
    await saveRemoteReport(report, report.own);
    result.reportsReceived++;
  }

  if (page.cursor) await saveSyncState(REPORT_CURSOR, page.cursor);
  if (!page.complete) result.complete = false;
}

export { NotAuthenticatedError };
