/** The account on this device.
 *
 *  Who is signed in, what they declared about themselves, and what the
 *  phone is carrying for them. The walks used to live here too and now have
 *  their own section, which leaves this screen with one subject instead of
 *  three.
 *
 *  The dark mode preference is stored with the profile because it is a
 *  decision about power draw and night vision rather than a matter of
 *  taste.
 */
import { Link, useFocusEffect, useRouter  } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';

import { endSession } from '../../src/data/api';
import {
  countPendingSync,
  listTrails,
  Profile as ProfileData,
  readProfile,
  saveLevel,
  TrailSummary,
} from '../../src/data/db';
import {
  downloadRegion,
  downloadedRegions,
  isStale,
  listRegions,
  regionsSupported,
  removeRegion,
  type DownloadedRegion,
  type Region,
} from '../../src/data/regions';
import { Level } from '../../src/domain/types';
import { Button } from '../../src/ui/forms';
import { StateView } from '../../src/ui/StateView';
import { difficultyColour, LEVEL_LABEL, Palette, sp, useTheme } from '../../src/ui/theme';

const LEVELS: Level[] = ['beginner', 'intermediate', 'advanced'];

export default function Profile() {
  const router = useRouter();
  const { c, mode, toggle } = useTheme();
  const s = useMemo(() => styles(c), [c]);
  const colour = difficultyColour(c);

  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [pending, setPending] = useState(0);
  const [offlineReady, setOfflineReady] = useState<TrailSummary[]>([]);
  const [regions, setRegions] = useState<Region[]>([]);
  const [held, setHeld] = useState<DownloadedRegion[]>([]);
  const [busyRegion, setBusyRegion] = useState<string | null>(null);
  const [regionProgress, setRegionProgress] = useState(0);
  const [regionError, setRegionError] = useState<string | null>(null);
  // Which region the failed attempt was for, so the retry knows what to try
  // again rather than offering a button that has to guess.
  const [failedRegion, setFailedRegion] = useState<Region | null>(null);
  const [leaving, setLeaving] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        const [p, n, list] = await Promise.all([readProfile(), countPendingSync(), listTrails()]);
        if (!active) return;
        setProfile(p);
        setPending(n);
        setOfflineReady(list.filter((t) => t.downloadedAt !== null));
        setHeld(await downloadedRegions());

        // The region catalogue needs the server, so a failure here is
        // ordinary rather than exceptional. The section simply shows
        // nothing instead of the screen refusing to load.
        try {
          const available = await listRegions();
          if (active) setRegions(available.filter((r) => r.available));
        } catch {
          if (active) setRegions([]);
        }
      })();
      return () => {
        active = false;
      };
    }, []),
  );

  async function changeLevel(level: Level) {
    await saveLevel(level);
    setProfile((p) => (p ? { ...p, level } : p));
  }

  /** Brings a region's tiles onto the phone. Long, and never automatic. */
  async function getRegion(region: Region) {
    setBusyRegion(region.id);
    setRegionProgress(0);
    setRegionError(null);
    setFailedRegion(null);
    try {
      await downloadRegion(region, (p) => setRegionProgress(p.percentage));
      setHeld(await downloadedRegions());
    } catch (error) {
      // The reason comes from the native downloader and is shown as it
      // arrived. A region fails to download for reasons that have nothing
      // to do with signal, and hiding them behind one sentence about the
      // connection is what made the last one take an afternoon to find.
      const detail = error instanceof Error ? error.message : null;
      setFailedRegion(region);
      setRegionError(
        detail ?? 'Puede que se haya cortado la conexión. Volvé a intentar en un momento.',
      );
    } finally {
      setBusyRegion(null);
    }
  }

  async function discardRegion(region: Region) {
    await removeRegion(region.id);
    setHeld(await downloadedRegions());
  }

  /**
   * Ends the session on this device.
   *
   * Nothing the hiker recorded is deleted, and that is worth saying out
   * loud in the confirmation, because every other application teaches
   * people that signing out loses things. What does stay behind is the
   * queue, so anything unsent is named before they leave.
   */
  function askToSignOut() {
    const queued =
      pending > 0
        ? `\n\nTenés ${pending} reporte${pending === 1 ? '' : 's'} sin enviar. Si cerrás sesión ahora ${pending === 1 ? 'queda guardado' : 'quedan guardados'} en el teléfono y se ${pending === 1 ? 'envía' : 'envían'} cuando vuelvas a entrar.`
        : '';
    Alert.alert(
      '¿Cerrar sesión?',
      `Tus recorridos, tus senderos descargados y los mapas sin conexión se quedan en este teléfono. Vas a necesitar conexión para volver a entrar.${queued}`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Cerrar sesión',
          style: 'destructive',
          onPress: async () => {
            setLeaving(true);
            await endSession();
            router.replace('/welcome');
          },
        },
      ],
    );
  }

  if (!profile) {
    return (
      <View style={s.centre}>
        <ActivityIndicator color={c.primary} />
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
      <Text style={s.title}>Perfil</Text>

      <View style={s.identity}>
        <View style={s.monogram}>
          <Text style={s.monogramText}>{profile.name.slice(0, 1).toUpperCase()}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.name}>{profile.name}</Text>
          <Text style={s.email}>{profile.email}</Text>
        </View>
      </View>

      <Text style={s.section}>Nivel de experiencia</Text>
      <View style={s.levels}>
        {LEVELS.map((l) => {
          const chosen = profile.level === l;
          return (
            <Pressable
              key={l}
              onPress={() => changeLevel(l)}
              style={[s.levelChip, chosen && { backgroundColor: colour[l], borderColor: colour[l] }]}
            >
              <Text style={[s.levelText, chosen && { color: '#ffffff' }]}>{LEVEL_LABEL[l]}</Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={s.section}>Apariencia</Text>
      <View style={s.switchRow}>
        <View style={{ flex: 1 }}>
          <Text style={s.switchTitle}>Modo oscuro</Text>
        </View>
        <Switch value={mode === 'dark'} onValueChange={toggle} />
      </View>

      <Text style={s.section}>En este teléfono</Text>
      <View style={s.card}>
        <Text style={s.cardText}>
          {offlineReady.length === 0
            ? 'Todavía no descargaste ningún sendero.'
            : `${offlineReady.length} sendero${offlineReady.length === 1 ? '' : 's'} disponible${
                offlineReady.length === 1 ? '' : 's'
              } para recorrer sin conexión.`}
        </Text>
        {offlineReady.map((t) => (
          <Text key={t.id} style={s.listItem}>
            {t.name}
          </Text>
        ))}
        <Text style={s.cardNote}>
          {pending === 0
            ? 'No hay reportes pendientes de enviar.'
            : `${pending} reporte${pending === 1 ? '' : 's'} esperando conexión.`}
        </Text>
      </View>

      <Text style={s.section}>Mapas sin conexión</Text>
      {!regionsSupported() || regions.length === 0 ? (
        <Text style={s.hint}>Sincronizá para ver las regiones disponibles.</Text>
      ) : (
        regions.map((r) => {
          const tiene = held.some((h) => h.regionId === r.id);
          const vieja = isStale(r, held);
          const ocupado = busyRegion === r.id;
          return (
            <View key={r.id} style={s.regionCard}>
              <Text style={s.regionTitle}>{r.name}</Text>
              <Text style={s.regionDetail}>{r.description}</Text>
              <Text style={s.regionDetail}>
                {(r.sizeBytes / 1048576).toFixed(0)} MB · {r.tileCount.toLocaleString('es-AR')}{' '}
                baldosas · zoom {r.minZoom} a {r.maxZoom}
              </Text>
              {vieja && (
                <Text style={s.regionDetail}>
                  La que tenés guardada quedó desactualizada. Volvé a descargarla para tener el
                  área y los datos nuevos.
                </Text>
              )}
              {ocupado ? (
                <Text style={s.regionDetail}>Descargando… {Math.round(regionProgress)} %</Text>
              ) : (
                <>
                  <Pressable style={s.regionButton} onPress={() => getRegion(r)}>
                    <Text style={s.regionButtonText}>
                      {vieja
                        ? 'Actualizar la región'
                        : tiene
                          ? 'Volver a descargar'
                          : 'Descargar para usar sin conexión'}
                    </Text>
                  </Pressable>
                  {tiene && (
                    <Pressable onPress={() => discardRegion(r)}>
                      <Text style={s.hint}>Eliminar del teléfono</Text>
                    </Pressable>
                  )}
                </>
              )}
            </View>
          );
        })
      )}
      {regionError && (
        <StateView
          kind="failed"
          compact
          title="No pudimos descargar la región"
          detail={regionError}
          action={{
            label: 'Volver a intentar',
            onPress: () => failedRegion && void getRegion(failedRegion),
          }}
        />
      )}

      {/* The two requirements that can only be answered on a device.
          Instrumentation rather than a feature, which is why it sits at
          the foot of the screen and not in the tab bar. */}
      <Text style={s.section}>Mediciones</Text>
      <Link href="/measurements" style={s.link}>
        Medir rendimiento y consumo de batería
      </Link>

      <View style={s.leave}>
        <Button
          label="Cerrar sesión"
          variant="outline"
          tone="danger"
          onPress={askToSignOut}
          busy={leaving}
        />
      </View>
    </ScrollView>
  );
}

const styles = (c: Palette) =>
  StyleSheet.create({
    content: { padding: sp.lg, paddingBottom: sp.xl * 2 },
    centre: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    title: { fontSize: 32, fontWeight: '800', color: c.text, marginBottom: sp.lg },

    identity: { flexDirection: 'row', alignItems: 'center', gap: sp.md },
    monogram: {
      width: 54,
      height: 54,
      borderRadius: 27,
      backgroundColor: c.primarySoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    monogramText: { color: c.primary, fontWeight: '800', fontSize: 22 },
    name: { fontSize: 19, fontWeight: '800', color: c.text },
    email: { color: c.mutedText, fontSize: 13, marginTop: 2 },

    section: {
      color: c.text,
      fontWeight: '700',
      fontSize: 13,
      marginTop: sp.xl,
      marginBottom: sp.sm,
    },
    levels: { flexDirection: 'row', gap: sp.sm },
    levelChip: {
      flex: 1,
      borderColor: c.border,
      borderWidth: 1.5,
      borderRadius: 22,
      paddingVertical: 10,
      alignItems: 'center',
    },
    levelText: { color: c.text, fontSize: 12.5, fontWeight: '600', textTransform: 'capitalize' },
    hint: { color: c.mutedText, fontSize: 11.5, marginTop: sp.sm, lineHeight: 16 },

    switchRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: sp.md,
      backgroundColor: c.surface,
      borderColor: c.border,
      borderWidth: 1,
      borderRadius: 14,
      padding: sp.lg,
    },
    switchTitle: { color: c.text, fontWeight: '700', fontSize: 14 },

    card: {
      backgroundColor: c.surface,
      borderColor: c.border,
      borderWidth: 1,
      borderRadius: 14,
      padding: sp.lg,
    },
    cardText: { color: c.text, fontSize: 13.5 },
    link: { color: c.primary, fontSize: 13.5, fontWeight: '700', paddingVertical: sp.sm },
    listItem: { color: c.mutedText, fontSize: 12.5, marginTop: sp.sm, lineHeight: 18 },
    cardNote: { color: c.mutedText, fontSize: 11.5, marginTop: sp.md, lineHeight: 16 },

    regionCard: {
      backgroundColor: c.surface,
      borderColor: c.border,
      borderWidth: 1,
      borderRadius: 14,
      padding: sp.lg,
      marginBottom: sp.sm,
      gap: sp.xs,
    },
    regionTitle: { color: c.text, fontWeight: '700', fontSize: 14 },
    regionDetail: { color: c.mutedText, fontSize: 12.5, lineHeight: 18 },
    regionButton: {
      backgroundColor: c.primary,
      borderRadius: 22,
      paddingVertical: 12,
      alignItems: 'center',
      marginTop: sp.sm,
    },
    regionButtonText: { color: c.onPrimary, fontWeight: '700', fontSize: 13 },

    leave: { marginTop: sp.xl * 1.5 },
  });
