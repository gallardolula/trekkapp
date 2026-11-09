/** What the hiker actually walked.
 *
 *  Its own section rather than a block inside the profile. A walk is not a
 *  setting: it accumulates, it is the only record of what happened out
 *  there, and buried under the appearance switch nobody would find it.
 *
 *  What it shows is the difference between the trail and the outing. The
 *  distance covered, how many fixes the receiver gave, and how many times
 *  the hiker left the path. That last number is the one worth keeping,
 *  because it is evidence of what the system warned and when.
 */
import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { deleteHike, listHikes, type HikeSummary } from '../../src/data/db';
import { prepareStorage } from '../../src/startup/storage';
import { StateView } from '../../src/ui/StateView';
import { Palette, sp, useTheme } from '../../src/ui/theme';

const DATE: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long', year: 'numeric' };

/** How long the outing took, when it was closed properly. */
function duration(started: string, finished: string | null): string | null {
  if (!finished) return null;
  const minutes = Math.round((new Date(finished).getTime() - new Date(started).getTime()) / 60000);
  if (minutes < 1) return null;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

export default function Hikes() {
  const { c } = useTheme();
  const s = useMemo(() => styles(c), [c]);
  const [hikes, setHikes] = useState<HikeSummary[] | null>(null);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        await prepareStorage();
        const list = await listHikes();
        if (active) setHikes(list);
      })();
      return () => {
        active = false;
      };
    }, []),
  );

  function askToRemove(h: HikeSummary) {
    Alert.alert(
      'Eliminar del historial',
      `Se va a borrar el recorrido de ${h.trailName} y las ${h.points} lecturas que guardó. No se puede deshacer.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar',
          style: 'destructive',
          onPress: async () => {
            await deleteHike(h.id);
            setHikes(await listHikes());
          },
        },
      ],
    );
  }

  const total = (hikes ?? []).reduce((sum, h) => sum + h.distanceM, 0);

  return (
    <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
      <Text style={s.title}>Recorridos</Text>

      {hikes !== null && hikes.length > 0 && (
        <View style={s.summary}>
          {[
            [String(hikes.length), hikes.length === 1 ? 'salida' : 'salidas'],
            [(total / 1000).toFixed(1), 'km caminados'],
            [
              String(hikes.reduce((n, h) => n + h.deviations, 0)),
              'desvíos avisados',
            ],
          ].map(([value, label]) => (
            <View key={label} style={s.stat}>
              <Text style={s.statValue}>{value}</Text>
              <Text style={s.statLabel}>{label}</Text>
            </View>
          ))}
        </View>
      )}

      {hikes === null ? null : hikes.length === 0 ? (
        <StateView
          kind="empty"
          title="Todavía no registraste ninguna caminata"
          detail="Cuando entres a un sendero y toques iniciar, la aplicación guarda por dónde caminaste, aunque no tengas señal."
        />
      ) : (
        hikes.map((h) => {
          const length = duration(h.startedAt, h.finishedAt);
          return (
            <View key={h.id} style={s.card}>
              <View style={s.cardHead}>
                <Text style={s.cardName}>{h.trailName}</Text>
                {h.finishedAt === null && <Text style={s.openBadge}>sin cerrar</Text>}
              </View>
              <Text style={s.cardDate}>
                {new Date(h.startedAt).toLocaleDateString('es-AR', DATE)}
                {length ? ` · ${length}` : ''}
              </Text>

              <View style={s.figures}>
                {[
                  [`${(h.distanceM / 1000).toFixed(2)} km`, 'caminados'],
                  [String(h.points), h.points === 1 ? 'lectura' : 'lecturas'],
                  [
                    String(h.deviations),
                    h.deviations === 1 ? 'desvío' : 'desvíos',
                  ],
                ].map(([value, label]) => (
                  <View key={label} style={s.figure}>
                    <Text style={s.figureValue}>{value}</Text>
                    <Text style={s.figureLabel}>{label}</Text>
                  </View>
                ))}
              </View>

              <Pressable onPress={() => askToRemove(h)} hitSlop={8}>
                <Text style={s.remove}>Eliminar del historial</Text>
              </Pressable>
            </View>
          );
        })
      )}
    </ScrollView>
  );
}

const styles = (c: Palette) =>
  StyleSheet.create({
    content: { padding: sp.lg, paddingBottom: sp.xl * 2 },
    title: { fontSize: 32, fontWeight: '800', color: c.text, marginBottom: sp.lg },

    summary: {
      flexDirection: 'row',
      backgroundColor: c.surface,
      borderColor: c.border,
      borderWidth: 1,
      borderRadius: 18,
      paddingVertical: sp.lg,
      marginBottom: sp.sm,
    },
    stat: { flex: 1, alignItems: 'center' },
    statValue: { color: c.text, fontSize: 20, fontWeight: '800' },
    statLabel: { color: c.mutedText, fontSize: 11.5, marginTop: 2, textAlign: 'center' },

    card: {
      backgroundColor: c.surface,
      borderColor: c.border,
      borderWidth: 1,
      borderRadius: 18,
      padding: sp.lg,
      marginTop: sp.md,
    },
    cardHead: { flexDirection: 'row', alignItems: 'center', gap: sp.sm },
    cardName: { color: c.text, fontSize: 17, fontWeight: '700', flex: 1 },
    openBadge: {
      color: c.warning,
      backgroundColor: c.warningSoft,
      fontSize: 11,
      fontWeight: '700',
      borderRadius: 10,
      paddingVertical: 3,
      paddingHorizontal: 8,
      overflow: 'hidden',
    },
    cardDate: { color: c.mutedText, fontSize: 12.5, marginTop: 2 },

    figures: { flexDirection: 'row', marginTop: sp.lg, gap: sp.lg },
    figure: { flex: 1 },
    figureValue: { color: c.text, fontSize: 16, fontWeight: '700' },
    figureLabel: { color: c.mutedText, fontSize: 11.5, marginTop: 1 },

    remove: { color: c.danger, fontSize: 12.5, fontWeight: '600', marginTop: sp.lg },

    empty: {
      backgroundColor: c.surface,
      borderColor: c.border,
      borderWidth: 1,
      borderRadius: 18,
      padding: sp.lg,
    },
    emptyTitle: { color: c.text, fontWeight: '700', fontSize: 15 },
    emptyText: { color: c.mutedText, fontSize: 13, lineHeight: 19, marginTop: sp.sm },
  });
