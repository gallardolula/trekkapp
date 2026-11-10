/** What somebody sees before there is an account on the device.
 *
 *  Its own screen rather than a branch inside the home screen. The home
 *  screen belongs to the tab bar and assumes a hiker with a level and a
 *  catalogue; this one has neither, and showing the tabs over it would
 *  offer four sections that cannot be used yet.
 *
 *  It says one thing and asks for one decision. The claim is about what the
 *  application does differently rather than what it is, because somebody
 *  arriving here can already guess it has trails in it.
 */
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '../src/ui/forms';
import { Palette, sp, useTheme } from '../src/ui/theme';

/**
 * The application icon itself, as it appears on a home screen.
 *
 * The same artwork the launcher shows, rendered from the same vector master
 * as every other size, so the first screen and the icon somebody tapped to
 * reach it are one image and not two drawings of the same idea.
 */
const ICON = require('../assets/icon.png');

export default function Welcome() {
  const router = useRouter();
  const { c } = useTheme();
  const s = useMemo(() => styles(c), [c]);
  // No header and no tab bar here, so nothing else is keeping the buttons
  // clear of the system controls at the bottom of the screen.
  const insets = useSafeAreaInsets();

  return (
    <View style={[s.screen, { paddingTop: insets.top + sp.lg, paddingBottom: insets.bottom + sp.lg }]}>
      <View style={s.middle}>
        <Image source={ICON} style={s.icon} accessibilityIgnoresInvertColors />
        <Text style={s.brand}>TrekkApp</Text>
      </View>

      <View style={s.actions}>
        <Button label="Crear una cuenta" onPress={() => router.push('/signup')} />
        <Button label="Ya tengo cuenta" variant="outline" onPress={() => router.push('/signin')} />
      </View>
    </View>
  );
}

const styles = (c: Palette) =>
  StyleSheet.create({
    screen: { flex: 1, paddingHorizontal: sp.xl, justifyContent: 'space-between' },
    middle: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    // The radius a launcher gives an icon of this size, so it reads as the
    // icon and not as a square photograph.
    icon: { width: 104, height: 104, borderRadius: 24 },
    brand: { fontSize: 32, fontWeight: '800', color: c.text, marginTop: sp.md },
    actions: { gap: sp.sm },
  });
