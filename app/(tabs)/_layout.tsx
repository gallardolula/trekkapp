/** The four sections of the application.
 *
 *  A tab bar and not a stack of screens pushed from a menu. The difference
 *  matters on a trail: every section stays one thumb away, and leaving one
 *  does not mean walking back out the way you came in. It is also what the
 *  hiker already expects, because it is what every application of this kind
 *  does.
 *
 *  Four and not more. Each one answers a question somebody actually asks:
 *  what can I do right now, what is there to walk, what have I walked, and
 *  who am I on this phone.
 */
import { Tabs } from 'expo-router';
import type { ColorValue } from 'react-native';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HikesIcon, HomeIcon, ProfileIcon, TrailIcon, type IconProps } from '../../src/ui/icons';
import { OfflineBar } from '../../src/ui/OfflineBar';
import { sp, useTheme } from '../../src/ui/theme';

const s = StyleSheet.create({
  bar: { position: 'absolute', left: 0, right: 0 },
});

/** The bar itself, above whatever the system puts below it. */
const BAR_HEIGHT = 60;

export default function TabsLayout() {
  const { c } = useTheme();

  // Android draws its own back, home and recents controls over the bottom
  // of the screen, and on a phone with gesture navigation it draws a bar
  // instead. Either way the space belongs to the system, and a tab bar of
  // a fixed height sits underneath them with its labels unreadable and its
  // targets stealing the taps. The inset is how much of the bottom is
  // already spoken for.
  const insets = useSafeAreaInsets();

  // The navigator hands the icon a colour it has already resolved from the
  // active and inactive tints, which is why neither is read here.
  const icon =
    (Icon: (p: IconProps) => React.ReactElement) =>
    ({ color, focused }: { color: ColorValue; focused: boolean }) => (
      <Icon colour={String(color)} active={focused} />
    );

  return (
    <View style={{ flex: 1 }}>
      <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: c.primary,
        tabBarInactiveTintColor: c.mutedText,
        tabBarStyle: {
          backgroundColor: c.surface,
          borderTopColor: c.border,
          // The bar grows by whatever the system reserves, and that extra
          // goes into the padding so the icons stay where they were rather
          // than being pushed up into the content.
          height: BAR_HEIGHT + insets.bottom,
          paddingTop: sp.xs,
          paddingBottom: insets.bottom + sp.xs,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
        sceneStyle: { backgroundColor: c.background },
      }}
    >
      <Tabs.Screen name="home" options={{ title: 'Inicio', tabBarIcon: icon(HomeIcon) }} />
      <Tabs.Screen name="catalog" options={{ title: 'Senderos', tabBarIcon: icon(TrailIcon) }} />
      <Tabs.Screen name="hikes" options={{ title: 'Recorridos', tabBarIcon: icon(HikesIcon) }} />
      <Tabs.Screen name="profile" options={{ title: 'Perfil', tabBarIcon: icon(ProfileIcon) }} />
      </Tabs>

      {/* Over the content rather than above it, so appearing and
          disappearing never moves the screen under somebody's thumb.
          Being offline is the condition this application was built for,
          not an error, so it belongs at the edge and not in the middle. */}
      <View style={[s.bar, { top: insets.top }]} pointerEvents="box-none">
        <OfflineBar />
      </View>
    </View>
  );
}
