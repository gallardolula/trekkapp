import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { ThemeProvider, useTheme } from '../src/ui/theme';

function Navigation() {
  const { c } = useTheme();
  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: c.primary },
          headerTintColor: c.onPrimary,
          headerTitleStyle: { fontWeight: '700' },
          contentStyle: { backgroundColor: c.background },
        }}
      >
        <Stack.Screen name="index" options={{ title: 'TrekkApp' }} />
        <Stack.Screen name="signup" options={{ title: 'Crear cuenta' }} />
        <Stack.Screen name="catalog" options={{ title: 'Senderos' }} />
        <Stack.Screen name="profile" options={{ title: 'Tu perfil' }} />
        <Stack.Screen name="trail/[id]" options={{ title: 'Sendero' }} />
        <Stack.Screen name="hike/[id]" options={{ title: 'Recorrido' }} />
      </Stack>
    </>
  );
}

export default function Layout() {
  return (
    <ThemeProvider>
      <Navigation />
    </ThemeProvider>
  );
}
