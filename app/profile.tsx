/** Hiker profile and appearance.
 *
 *  Holds the account data, the declared level and the light or dark mode
 *  preference, which is stored with the profile because it is a decision
 *  about power draw and night vision rather than a matter of taste.
 */
import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import {
  countPendingSync,
  listTrails,
  Profile as ProfileData,
  readProfile,
  saveLevel,
  TrailSummary,
} from '../src/data/db';
import { Level } from '../src/domain/types';
import {
  downloadRegion,
  downloadedRegions,
  isStale,
  listRegions,
  regionsSupported,
  removeRegion,
  type DownloadedRegion,
  type Region,
} from '../src/data/regions';
import { listHikes, type HikeSummary } from '../src/data/db';
import { prepareStorage } from '../src/startup/storage';
import { difficultyColour, LEVEL_LABEL, Palette, sp, useTheme } from '../src/ui/theme';

const LEVELS: Level[] = ['beginner', 'intermediate', 'advanced'];

export default function Profile() {
  const [regions, setRegions] = useState<Region[]>([]);
  const [held, setHeld] = useState<DownloadedRegion[]>([]);
  const [busyRegion, setBusyRegion] = useState<string | null>(null);
  const [regionProgress, setRegionProgress] = useState(0);
  const [regionError, setRegionError] = useState<string | null>(null);
  const [hikes, setHikes] = useState<HikeSummary[]>([]);
  const { c, mode, toggle } = useTheme();
  const s = useMemo(() => styles(c), [c]);
  const colour = difficultyColour(c);

  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [pending, setPending] = useState(0);
  const [offlineReady, setOfflineReady] = useState<TrailSummary[]>([]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        await prepareStorage();
        const [p, n, list] = await Promise.all([
          readProfile(),
          countPendingSync(),
          listTrails(),
        ]);
        if (!active) return;
        setProfile(p);
        setPending(n);
        setOfflineReady(list.filter((t) => t.downloadedAt !== null));

        // The region catalogue needs the server, so a failure here is
        // ordinary rather than exceptional. The section simply shows
        // nothing instead of the screen refusing to load.
        setHikes(await listHikes());
        setHeld(await downloadedRegions());
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
    try {
      await downloadRegion(region, (p) => setRegionProgress(p.percentage));
      setHeld(await downloadedRegions());
    } catch {
      setRegionError('No pudimos descargar la región. Revisá tu conexión y volvé a intentar.');
    } finally {
      setBusyRegion(null);
    }
  }

  async function discardRegion(region: Region) {
    await removeRegion(region.id);
    setHeld(await downloadedRegions());
  }

  if (!profile) {
    return (
      <View style={s.centre}>
        <ActivityIndicator color={c.primary} />
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={s.content}>
      <View style={s.identity}>
        <Text style={s.name}>{profile.name}</Text>
        <Text style={s.email}>{profile.email}</Text>
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
      <Text style={s.hint}>
        Determina cuándo la aplicación pide una confirmación antes de descargar un sendero.
      </Text>

      <Text style={s.section}>Apariencia</Text>
      <View style={s.switchRow}>
        <View style={{ flex: 1 }}>
          <Text style={s.switchTitle}>Modo oscuro</Text>
          <Text style={s.switchDetail}>
            Reduce el consumo en pantallas OLED y preserva la visión nocturna durante un recorrido
            en penumbra.
          </Text>
        </View>
        <Switch value={mode === 'dark'} onValueChange={toggle} />
      </View>

      <Text style={s.section}>Senderos descargados</Text>
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
      </View>

      <Text style={s.section}>Tus recorridos</Text>
      {hikes.length === 0 ? (
        <Text style={s.hint}>Todavía no registraste ninguna caminata.</Text>
      ) : (
        hikes.map((h) => {
          const fecha = new Date(h.startedAt).toLocaleDateString('es-AR', {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
          });
          return (
            <View key={h.id} style={s.regionCard}>
              <Text style={s.regionTitle}>{h.trailName}</Text>
              <Text style={s.regionDetail}>{fecha}</Text>
              <Text style={s.regionDetail}>
                {(h.distanceM / 1000).toFixed(2)} km caminados · {h.points} lecturas
                {h.deviations > 0
                  ? ` · ${h.deviations} desvío${h.deviations === 1 ? '' : 's'}`
                  : ' · sin desvíos'}
                {h.finishedAt === null ? ' · sin cerrar' : ''}
              </Text>
            </View>
          );
        })
      )}

      <Text style={s.section}>Mapas sin conexión</Text>
      {!regionsSupported() ? (
        <Text style={s.hint}>
          El mapa necesita la aplicación compilada. En Expo Go el recorrido muestra la traza
          esquemática, sin cartografía.
        </Text>
      ) : regions.length === 0 ? (
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
      {regionError && <Text style={s.hint}>{regionError}</Text>}

      <Text style={s.section}>Sincronización</Text>
      <View style={s.card}>
        <Text style={s.cardText}>
          {pending === 0
            ? 'No hay reportes pendientes de enviar.'
            : `${pending} reporte${pending === 1 ? '' : 's'} esperando conexión.`}
        </Text>
        <Text style={s.cardNote}>
          La sincronización con el servidor es un componente pendiente de implementación.
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = (c: Palette) =>
  StyleSheet.create({
    content: { padding: sp.lg, paddingBottom: sp.xl * 2 },
    centre: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    identity: { marginBottom: sp.lg },
    name: { fontSize: 22, fontWeight: '800', color: c.text },
    email: { color: c.mutedText, fontSize: 13, marginTop: 2 },
    regionCard: {
      backgroundColor: c.surface,
      borderColor: c.border,
      borderWidth: 1,
      borderRadius: 10,
      padding: sp.md,
      marginBottom: sp.sm,
      gap: sp.xs,
    },
    regionTitle: { color: c.text, fontWeight: '700', fontSize: 14 },
    regionDetail: { color: c.mutedText, fontSize: 12, lineHeight: 17 },
    regionButton: {
      backgroundColor: c.primary,
      borderRadius: 8,
      paddingVertical: sp.sm,
      alignItems: 'center',
      marginTop: sp.xs,
    },
    regionButtonText: { color: c.onPrimary, fontWeight: '700', fontSize: 13 },
    section: { color: c.text, fontWeight: '700', fontSize: 13, marginTop: sp.lg, marginBottom: sp.sm },
    levels: { flexDirection: 'row', gap: sp.sm },
    levelChip: {
      flex: 1,
      borderColor: c.border,
      borderWidth: 1,
      borderRadius: 20,
      paddingVertical: 8,
      alignItems: 'center',
    },
    levelText: { color: c.text, fontSize: 12, fontWeight: '600', textTransform: 'capitalize' },
    hint: { color: c.mutedText, fontSize: 11, marginTop: sp.sm, lineHeight: 16 },
    switchRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: sp.md,
      backgroundColor: c.surface,
      borderColor: c.border,
      borderWidth: 1,
      borderRadius: 10,
      padding: sp.md,
    },
    switchTitle: { color: c.text, fontWeight: '700', fontSize: 14 },
    switchDetail: { color: c.mutedText, fontSize: 12, marginTop: 2, lineHeight: 17 },
    card: {
      backgroundColor: c.surface,
      borderColor: c.border,
      borderWidth: 1,
      borderRadius: 10,
      padding: sp.md,
    },
    cardText: { color: c.text, fontSize: 13 },
    listItem: { color: c.mutedText, fontSize: 12, marginTop: sp.sm, lineHeight: 17 },
    cardNote: { color: c.mutedText, fontSize: 11, marginTop: sp.sm, lineHeight: 16 },
  });
