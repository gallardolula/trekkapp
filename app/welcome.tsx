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
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';

import { Button } from '../src/ui/forms';
import { Palette, sp, useTheme } from '../src/ui/theme';

/** The mark, drawn rather than shipped as an image so it follows the theme. */
function Logo({ colour, accent }: { colour: string; accent: string }) {
  return (
    <Svg width={72} height={72} viewBox="0 0 48 48">
      <Path d="M2 40 15 14l8.5 16.5L28 22l18 18z" fill={colour} />
      <Path d="M15 14l5 9.6-4.6 3.4-4-2.6z" fill={accent} />
    </Svg>
  );
}

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
        <Logo colour={c.primary} accent={c.warning} />
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
    brand: { fontSize: 32, fontWeight: '800', color: c.text, marginTop: sp.md },
    actions: { gap: sp.sm },
  });
