/** What kind of outing the hiker is after.
 *
 *  The last screen of signing up, and the only one that can be skipped.
 *  Nothing here is needed to use the application; it is asked now because
 *  somebody is already answering questions and will not come back to a
 *  settings screen to answer this one.
 *
 *  Several choices and not one. Somebody who walks short outings in the
 *  forest and the occasional summit is describing two different days, and
 *  a single answer would make them pick the one they do less often.
 *
 *  Stored on the device and sent nowhere. Nothing reads them yet either;
 *  the ranking of the catalogue that will is not built. See
 *  src/domain/preferences.ts.
 */
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  Binoculars,
  Clock,
  Droplets,
  Mountain,
  Signpost,
  Sun,
  Tent,
  TreePine,
  type LucideIcon,
} from 'lucide-react-native';

import { savePreferences } from '../src/data/db';
import {
  GROUP_LABEL,
  TRAIL_PREFERENCES,
  type PreferenceGroup,
} from '../src/domain/preferences';
import { Button, ONBOARDING_STEPS, Question, StepBar } from '../src/ui/forms';
import { Palette, sp, useTheme } from '../src/ui/theme';

/** One drawing per preference, kept beside the catalogue it illustrates. */
const ICON: Record<string, LucideIcon> = {
  short: Clock,
  full_day: Sun,
  multi_day: Tent,
  summit: Mountain,
  water: Droplets,
  forest: TreePine,
  marked: Signpost,
  quiet: Binoculars,
};

const GROUPS: PreferenceGroup[] = ['length', 'terrain', 'company'];

export default function Preferences() {
  const router = useRouter();
  const { c } = useTheme();
  const s = useMemo(() => styles(c), [c]);

  const [chosen, setChosen] = useState<string[]>([]);
  const [working, setWorking] = useState(false);

  function toggle(id: string) {
    setChosen((held) => (held.includes(id) ? held.filter((v) => v !== id) : [...held, id]));
  }

  async function finish() {
    if (working) return;
    setWorking(true);
    try {
      // Recorded even when nothing was picked. Asked and skipped is a
      // different state from never asked, and only the second is worth
      // asking again.
      await savePreferences(chosen);
    } catch {
      // Not worth stopping somebody on the last screen of signing up for.
      // The question can be asked again; the account cannot be created again.
    } finally {
      router.replace('/home');
    }
  }

  return (
    <View style={s.screen}>
      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        <StepBar step={5} of={ONBOARDING_STEPS} />
        <Question
          title="¿Qué senderos te gustan?"
          detail="Elegí los que quieras. Sirve para ordenar el catálogo y lo podés cambiar cuando quieras."
        />

        {GROUPS.map((group) => (
          <View key={group} style={s.group}>
            <Text style={s.groupLabel}>{GROUP_LABEL[group]}</Text>
            <View style={s.grid}>
              {TRAIL_PREFERENCES.filter((p) => p.group === group).map((p) => {
                const on = chosen.includes(p.id);
                const Icon = ICON[p.id]!;
                return (
                  <Pressable
                    key={p.id}
                    onPress={() => toggle(p.id)}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on }}
                    style={[s.tile, on && { backgroundColor: c.primary, borderColor: c.primary }]}
                  >
                    <Icon size={22} color={on ? c.onPrimary : c.text} strokeWidth={1.9} />
                    <Text style={[s.tileLabel, on && { color: c.onPrimary }]}>{p.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ))}
      </ScrollView>

      <View style={s.footer}>
        <Button
          label={chosen.length === 0 ? 'Saltar por ahora' : 'Continuar'}
          onPress={finish}
          busy={working}
        />
      </View>
    </View>
  );
}

const styles = (c: Palette) =>
  StyleSheet.create({
    screen: { flex: 1 },
    content: { padding: sp.lg, paddingTop: sp.xl, paddingBottom: sp.lg },
    group: { marginTop: sp.lg },
    groupLabel: { color: c.mutedText, fontSize: 12.5, fontWeight: '700', marginBottom: sp.sm },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm },
    tile: {
      width: '48%',
      gap: sp.sm,
      backgroundColor: c.surface,
      borderColor: c.border,
      borderWidth: 1.5,
      borderRadius: 14,
      padding: sp.lg,
      minHeight: 92,
      justifyContent: 'space-between',
    },
    tileLabel: { color: c.text, fontSize: 14, fontWeight: '700' },
    footer: {
      padding: sp.lg,
      borderTopWidth: 1,
      borderTopColor: c.border,
      backgroundColor: c.background,
    },
  });
