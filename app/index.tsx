/** Home screen.
 *
 *  Brings together the state of the account, the entry points to each
 *  section, and what is ready to be used offline, which is the fact the
 *  hiker needs before heading out.
 */
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { countPendingSync, listTrails, Profile, readProfile, TrailSummary } from '../src/data/db';
import { prepareStorage } from '../src/startup/storage';
import { LEVEL_LABEL, Palette, sp, useTheme } from '../src/ui/theme';

export default function Home() {
  const router = useRouter();
  const { c, refresh } = useTheme();
  const s = useMemo(() => styles(c), [c]);

  const [profile, setProfile] = useState<Profile | null>(null);
  const [trails, setTrails] = useState<TrailSummary[]>([]);
  const [downloaded, setDownloaded] = useState(0);
  const [pending, setPending] = useState(0);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        try {
          await prepareStorage();
          const [p, list, pend] = await Promise.all([
            readProfile(),
            listTrails(),
            countPendingSync(),
          ]);
          if (!active) return;
          setProfile(p);
          setTrails(list);
          setDownloaded(list.filter((t) => t.downloadedAt !== null).length);
          setPending(pend);
          setReady(true);
          refresh();
        } catch (err) {
          if (active) setError(String(err));
        }
      })();
      return () => {
        active = false;
      };
    }, [refresh]),
  );

  if (error) {
    return (
      <View style={s.centre}>
        <Text style={s.errorTitle}>No se pudo abrir el almacenamiento local</Text>
        <Text style={s.errorDetail}>{error}</Text>
      </View>
    );
  }

  if (!ready) {
    return (
      <View style={s.centre}>
        <ActivityIndicator color={c.primary} />
      </View>
    );
  }

  if (!profile) {
    return (
      <View style={s.welcome}>
        <Text style={s.brand}>TrekkApp</Text>
        <Text style={s.tagline}>
          Planificá y recorré senderos de montaña sin depender de la cobertura de red.
        </Text>
        <Pressable style={s.primaryButton} onPress={() => router.push('/signup')}>
          <Text style={s.primaryButtonText}>Comenzar</Text>
        </Pressable>
      </View>
    );
  }

  const firstName = profile.name.split(' ')[0] || 'caminante';
  const offlineReady = trails.filter((t) => t.downloadedAt !== null);

  return (
    <ScrollView contentContainerStyle={s.content}>
      <View style={s.header}>
        <Text style={s.greeting}>Hola, {firstName}</Text>
        <Text style={s.level}>Nivel {LEVEL_LABEL[profile.level]}</Text>
      </View>

      <View style={s.summary}>
        {[
          [String(trails.length), trails.length === 1 ? 'sendero' : 'senderos'],
          [String(downloaded), downloaded === 1 ? 'descargado' : 'descargados'],
          [String(pending), pending === 1 ? 'pendiente' : 'pendientes'],
        ].map(([v, label]) => (
          <View key={label} style={s.stat}>
            <Text style={s.statValue}>{v}</Text>
            <Text style={s.statLabel}>{label}</Text>
          </View>
        ))}
      </View>

      <Pressable style={s.feature} onPress={() => router.push('/catalog')}>
        <Text style={s.featureTitle}>Explorar senderos</Text>
        <Text style={s.featureText}>
          Consultá distancia, desnivel y exigencia, y descargá el que vayas a recorrer.
        </Text>
      </Pressable>

      <Text style={s.section}>Listos para salir</Text>
      {offlineReady.length === 0 ? (
        <View style={s.empty}>
          <Text style={s.emptyText}>
            Todavía no descargaste ningún sendero. Sin descargar, el recorrido no funciona sin
            cobertura de red.
          </Text>
        </View>
      ) : (
        offlineReady.map((t) => (
          <Pressable key={t.id} style={s.card} onPress={() => router.push(`/trail/${t.id}`)}>
            <View style={s.cardRow}>
              <Text style={s.cardName}>{t.name}</Text>
              <Text style={s.badge}>sin conexión</Text>
            </View>
            <Text style={s.cardMeta}>
              {(t.attributes.distanceM / 1000).toFixed(1)} km ·{' '}
              {Math.round(t.attributes.elevationGainM)} m · {LEVEL_LABEL[t.attributes.difficulty]}
            </Text>
          </Pressable>
        ))
      )}

      <Pressable style={s.secondary} onPress={() => router.push('/profile')}>
        <Text style={s.secondaryText}>Tu perfil y apariencia</Text>
      </Pressable>

      <Text style={s.footer}>
        {pending === 0
          ? 'No hay reportes pendientes de sincronizar'
          : `${pending} reporte${pending === 1 ? '' : 's'} esperando conexión`}
      </Text>
    </ScrollView>
  );
}

const styles = (c: Palette) =>
  StyleSheet.create({
    content: { padding: sp.lg, paddingBottom: sp.xl * 2 },
    centre: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: sp.xl },
    errorTitle: { color: c.danger, fontWeight: '700', marginBottom: sp.sm },
    errorDetail: { color: c.mutedText, fontSize: 12, textAlign: 'center' },
    welcome: { flex: 1, justifyContent: 'center', padding: sp.xl },
    brand: { fontSize: 34, fontWeight: '800', color: c.primary, textAlign: 'center' },
    tagline: {
      color: c.mutedText,
      fontSize: 15,
      lineHeight: 22,
      textAlign: 'center',
      marginTop: sp.md,
      marginBottom: sp.xl,
    },
    primaryButton: { backgroundColor: c.primary, borderRadius: 12, paddingVertical: 16, alignItems: 'center' },
    primaryButtonText: { color: c.onPrimary, fontWeight: '700', fontSize: 16 },
    header: { marginBottom: sp.lg },
    greeting: { fontSize: 24, fontWeight: '800', color: c.text },
    level: { color: c.mutedText, fontSize: 13, marginTop: 2, textTransform: 'capitalize' },
    summary: {
      flexDirection: 'row',
      backgroundColor: c.primarySoft,
      borderRadius: 12,
      paddingVertical: sp.md,
      marginBottom: sp.lg,
    },
    stat: { flex: 1, alignItems: 'center' },
    statValue: { fontSize: 20, fontWeight: '800', color: c.primary },
    statLabel: { fontSize: 11, color: c.mutedText, marginTop: 2 },
    feature: { backgroundColor: c.primary, borderRadius: 12, padding: sp.lg, marginBottom: sp.lg },
    featureTitle: { color: c.onPrimary, fontWeight: '800', fontSize: 17 },
    featureText: { color: c.onPrimary, opacity: 0.9, fontSize: 13, marginTop: sp.xs, lineHeight: 18 },
    card: {
      backgroundColor: c.surface,
      borderColor: c.border,
      borderWidth: 1,
      borderRadius: 10,
      padding: sp.md,
      marginBottom: sp.sm,
    },
    section: { color: c.text, fontWeight: '700', fontSize: 13, marginBottom: sp.sm },
    cardRow: { flexDirection: 'row', alignItems: 'center', gap: sp.sm },
    cardName: { color: c.text, fontWeight: '700', fontSize: 14, flex: 1 },
    badge: {
      color: c.success,
      fontSize: 10,
      fontWeight: '700',
      borderColor: c.success,
      borderWidth: 1,
      borderRadius: 10,
      paddingHorizontal: 7,
      paddingVertical: 2,
    },
    empty: {
      borderColor: c.border,
      borderWidth: 1,
      borderStyle: 'dashed',
      borderRadius: 10,
      padding: sp.md,
    },
    emptyText: { color: c.mutedText, fontSize: 12, lineHeight: 17, textAlign: 'center' },
    cardMeta: { color: c.mutedText, fontSize: 12, marginTop: 3 },
    secondary: {
      borderColor: c.border,
      borderWidth: 1,
      borderRadius: 10,
      padding: sp.md,
      alignItems: 'center',
      marginTop: sp.md,
    },
    secondaryText: { color: c.text, fontSize: 14, fontWeight: '600' },
    footer: { textAlign: 'center', color: c.mutedText, fontSize: 11, marginTop: sp.lg },
  });
