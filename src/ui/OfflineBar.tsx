/** The strip that says the server is out of reach.
 *
 *  Shown at the top of every section, above whatever the screen is doing,
 *  because being offline is not an error in this application and does not
 *  belong in the middle of a screen. It is the condition the whole thing
 *  was built for, and the only thing somebody needs to know is which of
 *  their actions will wait.
 *
 *  Absent while the answer is still unknown. A bar that flashes on at
 *  every launch and then disappears teaches people to ignore it.
 */
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useConnectivity } from '../data/connectivity';
import { Palette, sp, useTheme } from './theme';

export function OfflineBar({ pending = 0 }: { pending?: number }) {
  const { online, check } = useConnectivity();
  const { c } = useTheme();
  const s = useMemo(() => styles(c), [c]);

  if (online !== false) return null;

  return (
    <Pressable style={s.bar} onPress={() => void check()}>
      <View style={s.dot} />
      <Text style={s.text}>
        Sin conexión. Todo lo que ya descargaste funciona igual
        {pending > 0
          ? `, y ${pending === 1 ? 'tu reporte se envía' : `tus ${pending} reportes se envían`} cuando vuelva la señal.`
          : '.'}
      </Text>
    </Pressable>
  );
}

const styles = (c: Palette) =>
  StyleSheet.create({
    bar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: sp.sm,
      backgroundColor: c.warningSoft,
      paddingVertical: sp.sm,
      paddingHorizontal: sp.lg,
    },
    dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: c.warning },
    text: { color: c.warning, fontSize: 12, lineHeight: 17, flex: 1, fontWeight: '600' },
  });
