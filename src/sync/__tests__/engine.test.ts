/** Behaviour of the synchronisation engine.
 *
 *  The database and the HTTP client are replaced by doubles, so what is
 *  under test is the order of the steps and what the engine does with each
 *  answer. Those are the decisions that make an interrupted synchronisation
 *  safe to resume, and they are not visible from either side alone.
 */
import { NotAuthenticatedError } from '../../data/api';
import { REPORT_CURSOR, TRAIL_CURSOR, synchronise } from '../engine';

jest.mock('../../data/api', () => {
  class NotAuthenticatedError extends Error {}
  return {
    NotAuthenticatedError,
    requestAuthenticated: jest.fn(),
  };
});

jest.mock('../../data/db', () => ({
  listPendingReports: jest.fn(),
  confirmReportsSent: jest.fn(),
  recordSyncFailure: jest.fn(),
  readSyncState: jest.fn(),
  saveSyncState: jest.fn(),
  saveRemoteTrail: jest.fn(),
  saveTrackPoints: jest.fn(),
  countTrackPoints: jest.fn(),
  saveRemoteReport: jest.fn(),
  trailExists: jest.fn(),
  countPendingSync: jest.fn(),
}));

const api = jest.requireMock('../../data/api');
const db = jest.requireMock('../../data/db');

const TRAIL = {
  id: 'trail-1',
  name: 'Balcón Norte',
  status: 'published',
  updatedAt: '2026-11-08T10:00:00.000000Z',
  attributes: { distanceM: 1200, elevationGainM: 140, effortIndex: 2.6, difficulty: 'beginner' },
};

const REPORT = {
  id: 'report-1',
  trailId: 'trail-1',
  kind: 'arroyo_crecido',
  createdAt: '2026-11-08T12:00:00.000Z',
  own: false,
};

/** Answers each endpoint the engine calls, in the order it calls them. */
function server(overrides: Record<string, unknown> = {}) {
  const answers: Record<string, unknown> = {
    'POST /api/reports': { accepted: [], rejected: [] },
    'GET /api/trails': { trails: [], deleted: [], cursor: null, complete: true },
    'GET /api/reports': { reports: [], cursor: null, complete: true },
    ...overrides,
  };
  api.requestAuthenticated.mockImplementation((path: string, options?: { method?: string }) => {
    const method = options?.method ?? 'GET';
    const base = path.split('?')[0];
    if (base.endsWith('/track')) return Promise.resolve(answers['TRACK'] ?? { points: [] });
    const key = `${method} ${base}`;
    if (!(key in answers)) throw new Error(`sin respuesta preparada para ${key}`);
    return Promise.resolve(answers[key]);
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  db.listPendingReports.mockResolvedValue([]);
  db.readSyncState.mockResolvedValue(null);
  db.countTrackPoints.mockResolvedValue(0);
  db.trailExists.mockResolvedValue(true);
  db.countPendingSync.mockResolvedValue(0);
  server();
});

describe('order of the steps', () => {
  it('sends what the device produced before bringing anything down', async () => {
    // A pending report is the only information that exists in one place.
    // If the run is cut short, it must already be the part that completed.
    db.listPendingReports.mockResolvedValue([
      { id: 'r1', trailId: 'trail-1', kind: 'x', createdAt: '2026-11-08T12:00:00.000Z' },
    ]);
    server({ 'POST /api/reports': { accepted: ['r1'], rejected: [] } });

    await synchronise();

    const calls = api.requestAuthenticated.mock.calls.map(
      (c: [string, { method?: string }?]) => `${c[1]?.method ?? 'GET'} ${c[0].split('?')[0]}`,
    );
    expect(calls[0]).toBe('POST /api/reports');
    expect(calls.indexOf('GET /api/trails')).toBeGreaterThan(0);
  });
});

describe('sending reports', () => {
  it('confirms only what the server names as accepted', async () => {
    db.listPendingReports.mockResolvedValue([
      { id: 'r1', trailId: 'trail-1', kind: 'x', createdAt: '2026-11-08T12:00:00.000Z' },
      { id: 'r2', trailId: 'trail-9', kind: 'x', createdAt: '2026-11-08T12:00:00.000Z' },
    ]);
    server({
      'POST /api/reports': {
        accepted: ['r1'],
        rejected: [{ id: 'r2', reason: 'unknown_trail' }],
      },
    });

    const result = await synchronise();

    // r2 is not confirmed, so its queue entry survives and the report is
    // not marked as sent. That is the whole purpose of keeping a queue.
    expect(db.confirmReportsSent).toHaveBeenCalledWith(['r1']);
    expect(db.recordSyncFailure).toHaveBeenCalledWith('r2', 'unknown_trail');
    expect(result.reportsSent).toBe(1);
    expect(result.reportsRejected).toBe(1);
  });

  it('skips the upload when the queue is empty', async () => {
    await synchronise();
    const posts = api.requestAuthenticated.mock.calls.filter(
      (c: [string, { method?: string }?]) => c[1]?.method === 'POST',
    );
    expect(posts).toHaveLength(0);
  });

  it('reports the run as incomplete when the queue filled a whole batch', async () => {
    const many = Array.from({ length: 100 }, (_, i) => ({
      id: `r${i}`,
      trailId: 'trail-1',
      kind: 'x',
      createdAt: '2026-11-08T12:00:00.000Z',
    }));
    db.listPendingReports.mockResolvedValue(many);
    server({ 'POST /api/reports': { accepted: many.map((r) => r.id), rejected: [] } });

    const result = await synchronise();
    expect(result.complete).toBe(false);
  });
});

describe('bringing down the catalogue', () => {
  it('stores the trail and fetches a track the device does not have', async () => {
    server({
      'GET /api/trails': { trails: [TRAIL], deleted: [], cursor: TRAIL.updatedAt, complete: true },
      TRACK: { points: [{ lat: -31.65, lon: -64.68 }] },
    });

    const result = await synchronise();

    expect(db.saveRemoteTrail).toHaveBeenCalledWith(TRAIL);
    expect(db.saveTrackPoints).toHaveBeenCalledWith('trail-1', [{ lat: -31.65, lon: -64.68 }]);
    expect(result.tracksDownloaded).toBe(1);
  });

  it('does not refetch a track the device already holds', async () => {
    // The geometry is the largest request of the run. Asking for one the
    // device has would spend the connection on nothing.
    db.countTrackPoints.mockResolvedValue(480);
    server({
      'GET /api/trails': { trails: [TRAIL], deleted: [], cursor: TRAIL.updatedAt, complete: true },
    });

    const result = await synchronise();

    expect(db.saveTrackPoints).not.toHaveBeenCalled();
    expect(result.tracksDownloaded).toBe(0);
    expect(result.trailsReceived).toBe(1);
  });

  it('advances the cursor only after the page is stored', async () => {
    const order: string[] = [];
    db.saveRemoteTrail.mockImplementation(async () => void order.push('stored'));
    db.saveSyncState.mockImplementation(async (key: string) => void order.push(`cursor:${key}`));
    server({
      'GET /api/trails': { trails: [TRAIL], deleted: [], cursor: TRAIL.updatedAt, complete: true },
    });

    await synchronise();

    expect(order.indexOf('stored')).toBeLessThan(order.indexOf(`cursor:${TRAIL_CURSOR}`));
    expect(db.saveSyncState).toHaveBeenCalledWith(TRAIL_CURSOR, TRAIL.updatedAt);
  });

  it('sends the stored cursor on the following run', async () => {
    db.readSyncState.mockImplementation(async (key: string) =>
      key === TRAIL_CURSOR ? '2026-11-08T09:00:00.000000Z' : null,
    );
    await synchronise();
    const call = api.requestAuthenticated.mock.calls.find((c: [string]) =>
      c[0].startsWith('/api/trails?'),
    );
    expect(call[0]).toContain(encodeURIComponent('2026-11-08T09:00:00.000000Z'));
  });

  it('leaves the cursor untouched when the page is empty', async () => {
    await synchronise();
    expect(db.saveSyncState).not.toHaveBeenCalledWith(TRAIL_CURSOR, expect.anything());
  });

  it('marks the run incomplete when a page remained', async () => {
    server({
      'GET /api/trails': { trails: [], deleted: [], cursor: null, complete: false },
    });
    const result = await synchronise();
    expect(result.complete).toBe(false);
  });
});

describe('bringing down reports', () => {
  it('stores a report with the ownership the server reported', async () => {
    server({
      'GET /api/reports': { reports: [{ ...REPORT, own: true }], cursor: 'c', complete: true },
    });
    await synchronise();
    expect(db.saveRemoteReport).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'report-1' }),
      true,
    );
  });

  it('skips a report whose trail is not on the device', async () => {
    // Inserting it would violate the foreign key. It arrives on a later
    // run, once its trail does.
    db.trailExists.mockResolvedValue(false);
    server({ 'GET /api/reports': { reports: [REPORT], cursor: 'c', complete: true } });

    const result = await synchronise();

    expect(db.saveRemoteReport).not.toHaveBeenCalled();
    expect(result.reportsReceived).toBe(0);
  });

  it('stores the report cursor under its own key', async () => {
    server({ 'GET /api/reports': { reports: [REPORT], cursor: 'c-reports', complete: true } });
    await synchronise();
    expect(db.saveSyncState).toHaveBeenCalledWith(REPORT_CURSOR, 'c-reports');
  });
});

describe('failure', () => {
  it('lets a missing session reach the caller', async () => {
    // The caller turns this into a prompt to sign in, which no other
    // failure should produce.
    api.requestAuthenticated.mockRejectedValue(new api.NotAuthenticatedError());
    db.listPendingReports.mockResolvedValue([]);
    await expect(synchronise()).rejects.toBeInstanceOf(api.NotAuthenticatedError);
  });

  it('does not confirm reports when the upload fails', async () => {
    db.listPendingReports.mockResolvedValue([
      { id: 'r1', trailId: 'trail-1', kind: 'x', createdAt: '2026-11-08T12:00:00.000Z' },
    ]);
    api.requestAuthenticated.mockRejectedValue(new Error('network'));
    await expect(synchronise()).rejects.toThrow('network');
    expect(db.confirmReportsSent).not.toHaveBeenCalled();
  });
});

describe('exported error type', () => {
  it('is the one the api module defines', () => {
    expect(NotAuthenticatedError).toBe(api.NotAuthenticatedError);
  });
});
