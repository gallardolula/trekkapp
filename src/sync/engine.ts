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
  adoptServerTrail,
  confirmReportsSent,
  countPendingSync,
  listPendingTrails,
  stopContributing,
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
import { ApiError, NotAuthenticatedError, requestAuthenticated } from '../data/api';
import type { Point } from '../domain/types';

export const TRAIL_CURSOR = 'cursor.trails';
export const REPORT_CURSOR = 'cursor.reports';

export interface SyncResult {
  /** Trails the server accepted and published. */
  trailsSent: number;
  /** Trails it refused, which stay on this phone with the reason recorded. */
  trailsRefused: number;
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
    trailsSent: 0,
    trailsRefused: 0,
    reportsSent: 0,
    reportsRejected: 0,
    trailsReceived: 0,
    tracksDownloaded: 0,
    reportsReceived: 0,
    complete: true,
    pendingAfter: 0,
  };

  // Trails first. A report about a trail the server does not know is
  // refused, so contributing the trail before sending what was written
  // about it is the difference between one round trip and never.
  await pushTrails(result);
  await pushReports(result);
  await pullTrails(result);
  await pullReports(result);

  result.pendingAfter = await countPendingSync();
  return result;
}

/**
 * Contributes the trails somebody imported on this phone.
 *
 * The server assigns an identifier of its own, so the local trail is moved
 * onto it rather than left as a second copy of the same path. A refusal is
 * final and is recorded against the trail, which stays local: the track
 * will not become valid by being sent again.
 *
 * A duplicate is not a refusal in the same sense. The server names the
 * trail already published, and the local one is moved onto that, which is
 * what it is: somebody imported a recording of a path the catalogue
 * already holds.
 */
async function pushTrails(result: SyncResult): Promise<void> {
  for (const trail of await listPendingTrails()) {
    if (trail.points.length < 2) {
      await stopContributing(trail.id, 'no_geometry');
      result.trailsRefused++;
      continue;
    }

    try {
      const created = await requestAuthenticated<{ id: string }>('/api/trails', {
        method: 'POST',
        body: {
          name: trail.name,
          ...(trail.description ? { description: trail.description } : {}),
          points: trail.points,
        },
      });
      await adoptServerTrail(trail.id, created.id);
      result.trailsSent++;
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;

      const detail = error.detail as { reason?: string; trailId?: string } | undefined;
      if (error.status === 409 && typeof detail?.trailId === 'string') {
        await adoptServerTrail(trail.id, detail.trailId);
        result.trailsSent++;
        continue;
      }

      if (error.status === 422 || error.status === 400) {
        await stopContributing(trail.id, detail?.reason ?? 'invalid_track');
        result.trailsRefused++;
        continue;
      }

      throw error;
    }
  }
}

/**
 * Sends the queued reports.
 *
 * A batch the server refuses to parse is recorded against each report and
 * then set aside, rather than taken as a failure of the run. The reason is
 * that such a refusal is permanent: the batch will be refused again
 * tomorrow, and letting it propagate meant one unsendable report stopped the
 * catalogue and everybody else's reports from ever coming down. The entries
 * stay in the queue with the server's reason attached, which is what a later
 * version of the application needs in order to repair them.
 */
async function pushReports(result: SyncResult): Promise<void> {
  const pending = await listPendingReports();
  if (pending.length === 0) return;

  let response: UploadResult;
  try {
    response = await requestAuthenticated<UploadResult>('/api/reports', {
      method: 'POST',
      body: { reports: pending },
    });
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 400) throw error;
    for (const report of pending) {
      await recordSyncFailure(report.id, 'invalid_body');
    }
    result.reportsRejected = pending.length;
    result.complete = false;
    return;
  }

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
