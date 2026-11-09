/** Home.
 *
 *  Answers one question: what can I do right now. Everything on it is
 *  something the hiker can act on without leaving, and what is missing is
 *  as deliberate as what is here. There is no feed of other people's
 *  outings, because the application works without a connection and a feed
 *  that is empty or stale offline is worse than no feed.
 *
 *  The cards lead with the trail itself rather than a photograph. See
 *  `TrailArt` for why, and for what the drawing actually shows.
 */
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import {
  countPendingSync,
  listTrails,
  Profile,
  readProfile,
  readTrackShape,
  TrailSummary,
} from '../../src/data/db';
import { Point } from '../../src/domain/types';
import { NotAuthenticatedError, synchronise } from '../../src/sync/engine';
import { prepareStorage } from '../../src/startup/storage';
import { TrailArt } from '../../src/ui/TrailArt';
import { OfflineIcon, SyncIcon } from '../../src/ui/icons';
import { useConnectivity } from '../../src/data/connectivity';
import { StateView } from '../../src/ui/StateView';
import { difficultyColour, LEVEL_LABEL, Palette, sp, useTheme } from '../../src/ui/theme';

/** Which slice of the catalogue the feed is showing. */
type Filter = 'ready' | 'level' | 'all';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'ready', label: 'Listos sin conexión' },
  { id: 'level', label: 'Para tu nivel' },
  { id: 'all', label: 'Todos' },
];

const HARDER: Record<string, string[]> = {
  beginner: ['beginner'],
  intermediate: ['beginner', 'intermediate'],
  advanced: ['beginner', 'intermediate', 'advanced'],
};

export default function Home() {
  const router = useRouter();
  const { c, refresh } = useTheme();
  const s = useMemo(() => styles(c), [c]);
  const { width } = useWindowDimensions();
  const { online } = useConnectivity();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [trails, setTrails] = useState<TrailSummary[]>([]);
  const [shapes, setShapes] = useState<Record<string, Point[]>>({});
  const [pending, setPending] = useState(0);
  const [ready, setReady] = useState(false);
  const [filter, setFilter] = useState<Filter>('ready');
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        await prepareStorage();
        const [p, list, n] = await Promise.all([readProfile(), listTrails(), countPendingSync()]);
        if (!active) return;
        setProfile(p);
        setTrails(list);
        setPending(n);
        setReady(true);
        refresh();

        // The drawings are loaded after the cards are already on screen.
        // Each one is a separate read, and waiting for all of them before
        // showing anything would hold up a screen that is otherwise ready.
        for (const t of list) {
          const shape = await readTrackShape(t.id);
          if (!active) return;
          setShapes((prev) => ({ ...prev, [t.id]: shape }));
        }
      })();
      return () => {
        active = false;
      };
    }, [refresh]),
  );

  /**
   * Runs a synchronisation at the hiker's request.
   *
   * Explicit and never automatic, because the walk needs no network and a
   * background sync would spend the one resource that cannot be replaced
   * in the field on information nobody is waiting for.
   */
  async function runSync() {
    if (syncing) return;
    setSyncing(true);
    setSyncMessage(null);
    try {
      const result = await synchronise();
      const parts: string[] = [];
      const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
      if (result.reportsSent > 0)
        parts.push(plural(result.reportsSent, 'reporte enviado', 'reportes enviados'));
      if (result.trailsReceived > 0)
        parts.push(plural(result.trailsReceived, 'sendero actualizado', 'senderos actualizados'));
      if (result.reportsReceived > 0)
        parts.push(plural(result.reportsReceived, 'reporte recibido', 'reportes recibidos'));
      if (result.reportsRejected > 0)
        parts.push(plural(result.reportsRejected, 'rechazado', 'rechazados'));
      setSyncMessage(
        parts.length === 0
          ? 'Todo al día, no había nada para sincronizar'
          : `${parts.join(', ')}${result.complete ? '' : '. Queda más por traer, volvé a sincronizar'}`,
      );
      const [list, n] = await Promise.all([listTrails(), countPendingSync()]);
      setTrails(list);
      setPending(n);
    } catch (e) {
      setSyncMessage(
        e instanceof NotAuthenticatedError
          ? 'Tu sesión venció. Volvé a iniciar sesión para sincronizar.'
          : 'No pudimos sincronizar. Revisá tu conexión y volvé a intentar.',
      );
    } finally {
      setSyncing(false);
    }
  }

  if (!ready || !profile) {
    return (
      <View style={s.centre}>
        <ActivityIndicator color={c.primary} />
      </View>
    );
  }

  const firstName = profile.name.split(' ')[0] || 'caminante';
  const downloaded = trails.filter((t) => t.downloadedAt !== null);
  const allowed = HARDER[profile.level] ?? [];
  const shown =
    filter === 'ready'
      ? downloaded
      : filter === 'level'
        ? trails.filter((t) => allowed.includes(t.attributes.difficulty))
        : trails;

  const cardWidth = width - sp.lg * 2;
  const colour = difficultyColour(c);

  return (
    <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
      <Text style={s.title}>Inicio</Text>

      {/* The hiker, and the one action that needs a connection. Together,
          because deciding whether to synchronise is deciding whether this
          phone is ready to leave. */}
      <View style={s.hiker}>
        <View style={s.monogram}>
          <Text style={s.monogramText}>{firstName.slice(0, 1).toUpperCase()}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.hiName}>Hola, {firstName}</Text>
          <Text style={s.hiLevel}>
            Nivel {LEVEL_LABEL[profile.level]} · {downloaded.length} sin conexión
            {pending > 0 ? ` · ${pending} sin enviar` : ''}
          </Text>
        </View>
        {/* No button. Synchronising happens on its own whenever the
            application comes to the front and the server answers, so an
            action offering to do it would be asking for something that
            already happened. What is left is saying where things stand,
            and a way to insist only when there is something waiting and a
            server to send it to. */}
        {syncing ? (
          <View style={s.syncState}>
            <ActivityIndicator color={c.primary} size="small" />
          </View>
        ) : pending > 0 && online ? (
          <Pressable style={s.syncNow} onPress={runSync}>
            <SyncIcon colour={c.primary} size={15} />
            <Text style={s.syncNowText}>Enviar</Text>
          </Pressable>
        ) : null}
      </View>

      {syncMessage && <Text style={s.syncMessage}>{syncMessage}</Text>}

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={s.chips}
        style={s.chipRow}
      >
        {FILTERS.map((f) => {
          const on = filter === f.id;
          return (
            <Pressable
              key={f.id}
              onPress={() => setFilter(f.id)}
              style={[s.chip, on && { borderColor: c.primary, borderWidth: 2 }]}
            >
              <Text style={[s.chipText, on && { color: c.primary }]}>{f.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {shown.length === 0 ? (
        <StateView
          kind="empty"
          title={
            filter === 'ready'
              ? 'Todavía no marcaste ningún sendero'
              : 'No hay senderos para mostrar'
          }
          detail={
            filter === 'ready'
              ? 'Elegí el que vayas a caminar y dejalo listo antes de salir. Después funciona sin señal.'
              : 'El catálogo llega al sincronizar, y también podés importar un sendero desde un archivo GPX.'
          }
          action={{ label: 'Ver todos los senderos', onPress: () => router.navigate('/catalog') }}
        />
      ) : (
        shown.map((t) => {
          const offline = t.downloadedAt !== null;
          return (
            <Pressable
              key={t.id}
              style={s.card}
              onPress={() => router.push(`/trail/${t.id}`)}
              accessibilityRole="button"
            >
              <View style={s.art}>
                <TrailArt
                  track={shapes[t.id] ?? []}
                  colours={c}
                  width={cardWidth}
                  height={200}
                  tint={colour[t.attributes.difficulty]}
                />
                <View style={s.artOverlay}>
                  {offline && (
                    <View style={s.badge}>
                      <OfflineIcon colour={c.onPrimary} size={13} />
                      <Text style={s.badgeText}>En el teléfono</Text>
                    </View>
                  )}
                  <Text style={s.cardKind}>
                    {t.status === 'local' ? 'Sólo en tu teléfono' : 'Sendero'}
                  </Text>
                  <Text style={s.cardName}>{t.name}</Text>
                  <Text style={s.cardMeta}>
                    {(t.attributes.distanceM / 1000).toFixed(1)} km ·{' '}
                    {Math.round(t.attributes.elevationGainM)} m ·{' '}
                    {LEVEL_LABEL[t.attributes.difficulty]}
                  </Text>
                </View>
              </View>
            </Pressable>
          );
        })
      )}
    </ScrollView>
  );
}

const styles = (c: Palette) =>
  StyleSheet.create({
    content: { padding: sp.lg, paddingBottom: sp.xl * 2 },
    centre: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    title: { fontSize: 32, fontWeight: '800', color: c.text, marginBottom: sp.lg },

    hiker: { flexDirection: 'row', alignItems: 'center', gap: sp.md },
    monogram: {
      width: 46,
      height: 46,
      borderRadius: 23,
      backgroundColor: c.primarySoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    monogramText: { color: c.primary, fontWeight: '800', fontSize: 19 },
    hiName: { color: c.text, fontWeight: '700', fontSize: 16 },
    hiLevel: { color: c.mutedText, fontSize: 12.5, marginTop: 2 },
    syncState: { width: 44, alignItems: 'center' },
    syncNow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      borderColor: c.primary,
      borderWidth: 1.5,
      borderRadius: 20,
      paddingVertical: 8,
      paddingHorizontal: sp.md,
    },
    syncNowText: { color: c.primary, fontWeight: '700', fontSize: 12.5 },
    syncMessage: { color: c.mutedText, fontSize: 12.5, lineHeight: 18, marginTop: sp.md },

    chipRow: { marginTop: sp.lg, marginHorizontal: -sp.lg },
    chips: { gap: sp.sm, paddingHorizontal: sp.lg, paddingVertical: 2 },
    chip: {
      borderColor: c.border,
      borderWidth: 1.5,
      borderRadius: 22,
      paddingVertical: 9,
      paddingHorizontal: sp.lg,
      backgroundColor: c.surface,
    },
    chipText: { color: c.text, fontSize: 13, fontWeight: '600' },

    card: { marginTop: sp.lg, borderRadius: 18, overflow: 'hidden', backgroundColor: c.surface },
    art: { position: 'relative' },
    artOverlay: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: sp.lg },
    badge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      alignSelf: 'flex-start',
      backgroundColor: '#00000055',
      borderRadius: 14,
      paddingVertical: 5,
      paddingHorizontal: 10,
      marginBottom: sp.sm,
    },
    badgeText: { color: c.onPrimary, fontSize: 11, fontWeight: '700' },
    cardKind: { color: c.onPrimary, fontSize: 12.5, opacity: 0.9, fontWeight: '600' },
    cardName: { color: c.onPrimary, fontSize: 24, fontWeight: '800', marginTop: 2 },
    cardMeta: { color: c.onPrimary, fontSize: 13, opacity: 0.95, marginTop: 4 },

    empty: {
      marginTop: sp.lg,
      backgroundColor: c.surface,
      borderColor: c.border,
      borderWidth: 1,
      borderRadius: 18,
      padding: sp.lg,
    },
    emptyTitle: { color: c.text, fontWeight: '700', fontSize: 15 },
    emptyText: { color: c.mutedText, fontSize: 13, lineHeight: 19, marginTop: sp.sm },
    emptyAction: {
      marginTop: sp.lg,
      borderColor: c.primary,
      borderWidth: 1.5,
      borderRadius: 22,
      paddingVertical: 12,
      alignItems: 'center',
    },
    emptyActionText: { color: c.primary, fontWeight: '700', fontSize: 14 },
  });
