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
import { Alert, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { deleteHike, listHikes, listPhotos, photoFilesOf, type HikePhoto, type HikeSummary } from '../../src/data/db';
import { ImagePlus } from 'lucide-react-native';

import { cameraAvailable, capturePhoto, CameraRefused, deleteFile, pickPhotos } from '../../src/data/photos';
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
  // The photographs of each walk. Added here, once the walk is over, and
  // never on the walk screen, where the hands and the attention belong to
  // the path.
  const [galleries, setGalleries] = useState<Record<string, HikePhoto[]>>({});

  const loadGalleries = useCallback(async (list: HikeSummary[]) => {
    const entries = await Promise.all(list.map(async (h) => [h.id, await listPhotos(h.id)] as const));
    setGalleries(Object.fromEntries(entries));
  }, []);

  async function addPhotos(h: HikeSummary, from: 'camera' | 'library') {
    try {
      if (from === 'camera') await capturePhoto(h.id, null);
      else await pickPhotos(h.id);
      const photos = await listPhotos(h.id);
      setGalleries((prev) => ({ ...prev, [h.id]: photos }));
    } catch (error) {
      Alert.alert(
        'No pudimos agregar las fotos',
        error instanceof CameraRefused
          ? 'Hace falta permiso de cámara. Podés activarlo desde los ajustes del teléfono.'
          : 'Probá de nuevo en un momento.',
      );
    }
  }

  function chooseSource(h: HikeSummary) {
    Alert.alert('Agregar fotos', h.trailName, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Cámara', onPress: () => void addPhotos(h, 'camera') },
      { text: 'Galería', onPress: () => void addPhotos(h, 'library') },
    ]);
  }

  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        await prepareStorage();
        const list = await listHikes();
        if (!active) return;
        setHikes(list);
        await loadGalleries(list);
      })();
      return () => {
        active = false;
      };
    }, [loadGalleries]),
  );

  function askToRemove(h: HikeSummary) {
    const n = galleries[h.id]?.length ?? 0;
    Alert.alert(
      'Eliminar del historial',
      `Se va a borrar el recorrido de ${h.trailName}, las ${h.points} lecturas que guardó` +
        `${n > 0 ? ` y sus ${n} foto${n === 1 ? '' : 's'}` : ''}. No se puede deshacer.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar',
          style: 'destructive',
          onPress: async () => {
            // The files go too. The rows follow the walk by themselves,
            // through the foreign key, but nothing would ever delete the
            // images and nothing would ever show them again either.
            for (const uri of await photoFilesOf(h.id)) deleteFile(uri);
            await deleteHike(h.id);
            const list = await listHikes();
            setHikes(list);
            await loadGalleries(list);
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

              {(galleries[h.id]?.length ?? 0) > 0 && (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.gallery}>
                  {galleries[h.id]!.map((photo) => (
                    <Image key={photo.id} source={{ uri: photo.uri }} style={s.photo} />
                  ))}
                </ScrollView>
              )}

              <View style={s.actions}>
                {cameraAvailable() && (
                  <Pressable
                    onPress={() => chooseSource(h)}
                    style={s.addPhotos}
                    accessibilityRole="button"
                    hitSlop={8}
                  >
                    <ImagePlus color={c.primary} size={18} />
                    <Text style={s.addPhotosText}>Agregar fotos</Text>
                  </Pressable>
                )}
                <Pressable onPress={() => askToRemove(h)} hitSlop={8}>
                  <Text style={s.remove}>Eliminar</Text>
                </Pressable>
              </View>
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

    gallery: { marginTop: sp.lg },
    actions: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: sp.lg,
    },
    addPhotos: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    addPhotosText: { color: c.primary, fontSize: 13.5, fontWeight: '700' },
    photo: {
      width: 132,
      height: 132,
      borderRadius: 12,
      marginRight: sp.sm,
      backgroundColor: c.canvas,
    },
    remove: { color: c.danger, fontSize: 12.5, fontWeight: '600' },

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
