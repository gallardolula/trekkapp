/** The navigator the whole application hangs from.
 *
 *  Two kinds of screen. The tab bar holds the four sections somebody moves
 *  between all the time, and the stack holds what is entered from one of
 *  them and then left: a trail, a walk under way, signing in. Those carry a
 *  header with a way back; the sections do not, because each one writes its
 *  own title and there is nowhere to go back to.
 */
import { Stack } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';

import { ConnectivityProvider } from '../src/data/connectivity';
import { syncOnForeground } from '../src/sync/auto';
import { ThemeProvider, useTheme } from '../src/ui/theme';

function Navigation() {
  const { c, mode } = useTheme();

  // Synchronising whenever the application comes to the front, which it
  // only does while somebody is holding the phone and looking at it. The
  // module refuses during a walk and when the server does not answer, so
  // this is one subscription and no polling. See src/sync/auto.ts.
  useEffect(() => syncOnForeground(), []);

  return (
    <>
      <StatusBar style={mode === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: c.background },
          headerTintColor: c.text,
          headerTitleStyle: { fontWeight: '700' },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: c.background },
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="welcome" options={{ headerShown: false }} />
        <Stack.Screen name="signup" options={{ title: 'Crear cuenta' }} />
        <Stack.Screen name="signin" options={{ title: 'Iniciar sesión' }} />
        {/* The last screen of signing up. It keeps its way back, because
            somebody who cannot read the message needs to get out of it. */}
        <Stack.Screen name="verify" options={{ title: 'Confirmar el correo' }} />
        <Stack.Screen name="recover" options={{ title: 'Cambiar la contraseña' }} />
        <Stack.Screen name="measurements" options={{ title: 'Mediciones' }} />
        <Stack.Screen name="trail/[id]" options={{ title: 'Sendero' }} />
        {/* Full screen map, with its own floating controls over it. */}
        <Stack.Screen name="hike/[id]" options={{ headerShown: false }} />
      </Stack>
    </>
  );
}

export default function Layout() {
  return (
    // The gesture root has to sit above everything that reacts to a drag,
    // which is what lets the sheet on the hike screen be pulled up over
    // the map. Without it the sheet renders and does not move.
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider>
        <ConnectivityProvider>
          <Navigation />
        </ConnectivityProvider>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
