/** Trail catalogue.
 *
 *  Lists the trails with the attributes derived from their geometry and
 *  marks from the listing itself which ones exceed the declared level, so
 *  the warning does not appear only when the download is attempted.
 */
import { Link, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { listTrails, readProfile, TrailSummary } from '../src/data/db';
import { Level, LEVEL_ORDER } from '../src/domain/types';
import { prepareStorage } from '../src/startup/storage';
import { difficultyColour, LEVEL_LABEL, Palette, sp, useTheme } from '../src/ui/theme';

export default function Catalog() {
  const { c } = useTheme();
  const s = useMemo(() => styles(c), [c]);
  const colour = difficultyColour(c);

  const [trails, setTrails] = useState<TrailSummary[] | null>(null);
  const [level, setLevel] = useState<Level | null>(null);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        await prepareStorage();
        const [list, p] = await Promise.all([listTrails(), readProfile()]);
        if (!active) return;
        setTrails(list);
        setLevel(p?.level ?? null);
      })();
      return () => {
        active = false;
      };
    }, []),
  );

  if (!trails) {
    return (
      <View style={s.centre}>
        <ActivityIndicator color={c.primary} />
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={s.content}>
      {trails.map((t) => {
        const exceeds =
          level !== null && LEVEL_ORDER[t.attributes.difficulty] > LEVEL_ORDER[level];
        return (
          <Link key={t.id} href={`/trail/${t.id}`} asChild>
            <Pressable style={s.card}>
              <Text style={s.name}>{t.name}</Text>
              <Text style={s.meta}>
                {(t.attributes.distanceM / 1000).toFixed(1)} km ·{' '}
                {Math.round(t.attributes.elevationGainM)} m de desnivel
              </Text>
              <View style={s.row}>
                <View style={[s.chip, { backgroundColor: colour[t.attributes.difficulty] }]}>
                  <Text style={s.chipText}>{LEVEL_LABEL[t.attributes.difficulty]}</Text>
                </View>
                {exceeds && <Text style={s.exceeds}>Supera tu nivel</Text>}
                {t.downloadedAt !== null && <Text style={s.ready}>Descargado</Text>}
              </View>
            </Pressable>
          </Link>
        );
      })}
    </ScrollView>
  );
}

const styles = (c: Palette) =>
  StyleSheet.create({
    content: { padding: sp.lg, paddingBottom: sp.xl * 2 },
    centre: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    card: {
      backgroundColor: c.surface,
      borderColor: c.border,
      borderWidth: 1,
      borderRadius: 10,
      padding: sp.md,
      marginBottom: sp.md,
    },
    name: { fontSize: 15, fontWeight: '700', color: c.text },
    meta: { color: c.mutedText, marginTop: 4, fontSize: 13 },
    row: { flexDirection: 'row', alignItems: 'center', marginTop: sp.md, gap: sp.md },
    chip: { borderRadius: 20, paddingHorizontal: 10, paddingVertical: 3 },
    chipText: { color: '#ffffff', fontSize: 11, fontWeight: '700', textTransform: 'capitalize' },
    exceeds: { color: c.danger, fontSize: 12, fontWeight: '600' },
    ready: { color: c.success, fontSize: 12, fontWeight: '600', marginLeft: 'auto' },
  });
