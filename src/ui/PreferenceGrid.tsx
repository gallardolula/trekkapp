/** The grid of outing preferences, in groups.
 *
 *  Its own component because the question is asked while signing up and
 *  will be asked again from the profile, where somebody changes an answer
 *  they gave months ago. One grid, so the two cannot drift apart.
 *
 *  Several choices and not one. Somebody who walks short outings in the
 *  forest and the occasional summit is describing two different days, and
 *  a single answer would make them pick the one they do less often.
 */
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
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useMemo } from 'react';

import {
  GROUP_LABEL,
  TRAIL_PREFERENCES,
  type PreferenceGroup,
} from '../domain/preferences';
import { Palette, sp, useTheme } from './theme';

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

export interface PreferenceGridProps {
  chosen: string[];
  onChange: (chosen: string[]) => void;
}

export function PreferenceGrid({ chosen, onChange }: PreferenceGridProps) {
  const { c } = useTheme();
  const s = useMemo(() => styles(c), [c]);

  const toggle = (id: string) =>
    onChange(chosen.includes(id) ? chosen.filter((v) => v !== id) : [...chosen, id]);

  return (
    <View>
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
    </View>
  );
}

const styles = (c: Palette) =>
  StyleSheet.create({
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
  });
