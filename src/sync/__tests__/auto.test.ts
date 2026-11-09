/** When the application synchronises without being asked.
 *
 *  The value of this module is entirely in what it refuses to do. Running a
 *  synchronisation is the easy part; not running one during a walk, not
 *  running two at once, and not reaching for the network on a phone with no
 *  session are what keep the decision in docs/adr/0004 intact.
 */
import {
  allowImmediateSync,
  setRecording,
  syncIfConnected,
  type AutoSyncOutcome,
} from '../auto';

jest.mock('react-native', () => ({
  AppState: { addEventListener: jest.fn(() => ({ remove: jest.fn() })) },
}));

jest.mock('../../data/api', () => ({ serverReachable: jest.fn() }));
jest.mock('../../data/session', () => ({ hasSession: jest.fn() }));
jest.mock('../../data/db', () => ({ countPendingSync: jest.fn() }));
jest.mock('../engine', () => {
  class NotAuthenticatedError extends Error {}
  return { NotAuthenticatedError, synchronise: jest.fn() };
});

const api = jest.requireMock('../../data/api');
const session = jest.requireMock('../../data/session');
const engine = jest.requireMock('../engine');

const RESULT = {
  reportsSent: 1,
  reportsRejected: 0,
  trailsReceived: 0,
  tracksDownloaded: 0,
  reportsReceived: 0,
  complete: true,
  pendingAfter: 0,
};

/** A phone with a session, coverage and a server that answers. */
function ready() {
  session.hasSession.mockResolvedValue(true);
  api.serverReachable.mockResolvedValue(true);
  engine.synchronise.mockResolvedValue(RESULT);
}

beforeEach(() => {
  jest.clearAllMocks();
  setRecording(false);
  allowImmediateSync();
  ready();
});

const why = (outcome: AutoSyncOutcome) => (outcome.ran ? 'ran' : outcome.why);

describe('when it runs', () => {
  it('synchronises on a phone with a session and a server that answers', async () => {
    const outcome = await syncIfConnected();
    expect(outcome).toEqual({ ran: true, result: RESULT });
    expect(engine.synchronise).toHaveBeenCalledTimes(1);
  });
});

describe('when it refuses', () => {
  it('never runs during a walk', async () => {
    // The decision this module refines exists to keep a phone from hunting
    // for signal on a mountain. This is the case it protects.
    setRecording(true);
    expect(why(await syncIfConnected())).toBe('recording');
    expect(engine.synchronise).not.toHaveBeenCalled();
  });

  it('runs again once the walk is over', async () => {
    setRecording(true);
    await syncIfConnected();
    setRecording(false);
    expect(why(await syncIfConnected())).toBe('ran');
  });

  it('does not reach for the network with no session', async () => {
    session.hasSession.mockResolvedValue(false);
    expect(why(await syncIfConnected())).toBe('no-session');
    expect(api.serverReachable).not.toHaveBeenCalled();
  });

  it('says nothing happened when the server does not answer', async () => {
    api.serverReachable.mockResolvedValue(false);
    expect(why(await syncIfConnected())).toBe('unreachable');
    expect(engine.synchronise).not.toHaveBeenCalled();
  });

  it('does not run twice in a row for the same trip to the foreground', async () => {
    // Switching between applications emits one of these each time, and
    // without the interval a phone would synchronise on every glance.
    expect(why(await syncIfConnected())).toBe('ran');
    expect(why(await syncIfConnected())).toBe('too-soon');
    expect(engine.synchronise).toHaveBeenCalledTimes(1);
  });

  it('runs again once the interval has passed', async () => {
    await syncIfConnected();
    const later = Date.now() + 6 * 60_000;
    expect(why(await syncIfConnected(later))).toBe('ran');
  });

  it('does not start a second run while one is under way', async () => {
    let release: () => void = () => undefined;
    engine.synchronise.mockReturnValue(new Promise((r) => (release = () => r(RESULT))));

    const first = syncIfConnected();
    const second = await syncIfConnected();
    expect(why(second)).toBe('already-running');

    release();
    expect(why(await first)).toBe('ran');
  });

  it('leaves the interval alone when it did not get to run', async () => {
    // A phone with no coverage must not be locked out for five minutes:
    // the next time somebody opens the application it tries again.
    api.serverReachable.mockResolvedValue(false);
    expect(why(await syncIfConnected())).toBe('unreachable');
    api.serverReachable.mockResolvedValue(true);
    expect(why(await syncIfConnected())).toBe('ran');
  });
});
