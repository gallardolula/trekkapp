/** Where the application decides which half of itself to open.
 *
 *  A screen that renders nothing and redirects. Doing it here, rather than
 *  by leaving screens out of the navigator depending on the session, keeps
 *  every route registered at all times: a link into a trail opened while
 *  signed out then reaches a sign in screen instead of a navigator that has
 *  no such route.
 *
 *  Whether there is a session is read from the device, never from the
 *  server, so opening the application in the mountains behaves the same as
 *  opening it at home.
 */
import { Redirect } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { readProfile } from '../src/data/db';
import { hasSession } from '../src/data/session';
import { prepareStorage } from '../src/startup/storage';
import { useTheme } from '../src/ui/theme';

type Decision = 'checking' | 'home' | 'welcome';

export default function Entry() {
  const { c } = useTheme();
  const [decision, setDecision] = useState<Decision>('checking');

  useEffect(() => {
    let active = true;
    (async () => {
      // The database is opened here, before anything else, so the migrations
      // run once at start-up rather than racing between tabs.
      await prepareStorage();
      const [session, profile] = await Promise.all([hasSession(), readProfile()]);
      if (active) setDecision(session && profile ? 'home' : 'welcome');
    })().catch(() => {
      if (active) setDecision('welcome');
    });
    return () => {
      active = false;
    };
  }, []);

  if (decision === 'checking') {
    return (
      <View style={[styles.centre, { backgroundColor: c.background }]}>
        <ActivityIndicator color={c.primary} />
      </View>
    );
  }

  return <Redirect href={decision === 'home' ? '/home' : '/welcome'} />;
}

const styles = StyleSheet.create({
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
