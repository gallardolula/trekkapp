/** Whether the server is within reach, shared by every screen.
 *
 *  One answer for the whole application rather than each screen asking on
 *  its own. Three screens asking separately is three requests, three
 *  different answers at the same moment, and three different stories told
 *  to the same person.
 *
 *  What is tracked is reachability of this server, which is the question
 *  that matters and the one the platform cannot answer. A phone on a
 *  café's captive portal has a network and no server, and a phone on a
 *  ridge has neither; both are the same answer here and the same decision
 *  for whoever is holding it.
 *
 *  Nothing polls. The state is refreshed when the application comes to the
 *  front, and whenever something that did reach the network reports back,
 *  which is free and more current than any probe.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { serverReachable } from './api';

/** Null until the first answer, which is a different thing from offline. */
export type Reach = boolean | null;

interface Connectivity {
  online: Reach;
  /** Asks again, for a screen offering somebody a way to retry. */
  check: () => Promise<boolean>;
  /** Told by whoever just succeeded or failed at reaching the server. */
  report: (reached: boolean) => void;
}

const Ctx = createContext<Connectivity>({
  online: null,
  check: async () => false,
  report: () => undefined,
});

export function ConnectivityProvider({ children }: { children: React.ReactNode }) {
  const [online, setOnline] = useState<Reach>(null);

  const check = useCallback(async () => {
    const reached = await serverReachable();
    setOnline(reached);
    return reached;
  }, []);

  const report = useCallback((reached: boolean) => setOnline(reached), []);

  useEffect(() => {
    void check();
    const subscription = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'active') void check();
    });
    return () => subscription.remove();
  }, [check]);

  const value = useMemo(() => ({ online, check, report }), [online, check, report]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useConnectivity(): Connectivity {
  return useContext(Ctx);
}
