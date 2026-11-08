/** Assisted hike.
 *
 *  Continuously evaluates the distance between the hiker's position and the
 *  downloaded track, and applies the deviation rule with its hysteresis. Two
 *  position sources are offered: the device's satellite receiver, which is
 *  what the field uses, and a replay of the track with an induced departure,
 *  which lets the alert be seen opening and clearing without being on site.
 */
import * as Location from 'expo-location';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import {
  appendHikePoint,
  finishHike,
  startHike,
} from '../../src/data/db';
import { haversineDistance } from '../../src/domain/geo';
import { TrackMap } from '../../src/ui/TrackMap';
import { downloadedRegionIds, styleUrlFor } from '../../src/data/regions';

import { readTrackPoints, recordAlert, saveReport } from '../../src/data/db';
import { distanceToTrack } from '../../src/domain/geo';
import { evaluateDeviation, TOLERANCE_RADIUS_M } from '../../src/domain/rules';
import { totalDistance } from '../../src/domain/trail';
import { DeviationState, INITIAL_DEVIATION_STATE, Point } from '../../src/domain/types';
import { prepareStorage } from '../../src/startup/storage';
import { Palette, sp, useTheme } from '../../src/ui/theme';

const CANVAS = { width: 320, height: 300, margin: 18 };
const REPORT_KINDS = ['Vado crecido', 'Marca borrada', 'Paso cerrado'];

/** Shifts a point sideways by a given number of metres. */
function offsetPoint(p: Point, meters: number): Point {
  const degrees = meters / 111_320;
  return { ...p, lat: p.lat + degrees, lon: p.lon + degrees * 0.4 };
}

export default function Hike() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { c } = useTheme();
  const s = useMemo(() => styles(c), [c]);

  const [track, setTrack] = useState<Point[]>([]);
  const [position, setPosition] = useState<Point | null>(null);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  // The walk has two moments. Before it starts the screen shows the whole
  // route so the hiker can look it over; once started it follows them.
  const [navigating, setNavigating] = useState(false);
  // A simulated walk along the track, which is the only way to exercise
  // the deviation alert without being on the mountain.
  const [replay, setReplay] = useState(false);
  const [offTrack, setOffTrack] = useState(false);
  // The walk as it is actually being made, which differs from the trail
  // whenever somebody detours, turns back early or loses the path. Held in
  // refs because every position fix updates it and re-rendering on each
  // would be wasted work during a walk that lasts hours.
  const hikeId = useRef<string | null>(null);
  const recorded = useRef({ count: 0, metres: 0, deviations: 0, last: null as Point | null });
  const [walked, setWalked] = useState(0);
  // Changing this frames the entire route again.
  const [fitToken, setFitToken] = useState(0);
  const [distance, setDistance] = useState<number | null>(null);
  const [progress, setProgress] = useState(0);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [showReportKinds, setShowReportKinds] = useState(false);
  const [reportsMade, setReportsMade] = useState(0);
  const [counters, setCounters] = useState({ readings: 0, outside: 0, inside: 0 });

  const state = useRef<DeviationState>(INITIAL_DEVIATION_STATE);

  useEffect(() => {
    prepareStorage()
      .then(() => readTrackPoints(String(id)))
      .then(setTrack);
  }, [id]);

  /** Feeds one position reading into the rules engine. */
  function process(p: Point, progressIndex?: number) {
    if (track.length === 0) return;
    const r = distanceToTrack(p, track);
    setPosition(p);
    setDistance(r.meters);
    setProgress(progressIndex ?? r.segmentIndex);

    // Persisted as it arrives, not buffered. A hike lasts hours and the
    // application can be killed at any point; what is on disk survives.
    const current = hikeId.current;
    if (current) {
      const stamped: Point = { ...p, time: p.time ?? new Date().toISOString() };
      const previous = recorded.current.last;
      if (previous) recorded.current.metres += haversineDistance(previous, stamped);
      recorded.current.last = stamped;
      void appendHikePoint(current, recorded.current.count++, stamped);
      setWalked(recorded.current.metres);
    }

    const result = evaluateDeviation(r.meters, state.current);
    state.current = result.state;
    setCounters((x) => ({
      readings: x.readings + 1,
      outside: result.state.readingsOutside,
      inside: result.state.readingsInside,
    }));
    if (result.shouldAlert) {
      setOffTrack(true);
      recorded.current.deviations++;
      recordAlert({
        trailId: String(id),
        kind: 'deviation',
        detail: `A ${Math.round(r.meters)} m de la traza.`,
      });
    }
    if (result.shouldClearAlert) setOffTrack(false);
  }

  // The recording opens when the track is in place and closes when the
  // screen is left, which is the only moment the application can be sure
  // the walk is over.
  useEffect(() => {
    if (!navigating || track.length === 0) return;
    let active = true;
    (async () => {
      const created = await startHike(String(id));
      if (active) hikeId.current = created;
      else await finishHike(created, { distanceM: 0, deviations: 0 });
    })();
    return () => {
      active = false;
      const current = hikeId.current;
      if (!current) return;
      hikeId.current = null;
      void finishHike(current, {
        distanceM: recorded.current.metres,
        deviations: recorded.current.deviations,
      });
    };
  }, [navigating, track.length, id]);

  // Switching position source restarts tracking, so readings accumulated with
  // the previous source do not affect the new series.
  useEffect(() => {
    state.current = INITIAL_DEVIATION_STATE;
    setOffTrack(false);
    setDistance(null);
    setAccuracy(null);
    setCounters({ readings: 0, outside: 0, inside: 0 });
  }, [replay]);

  function start() {
    recorded.current = { count: 0, metres: 0, deviations: 0, last: null };
    setWalked(0);
    setNavigating(true);
  }

  function stop() {
    setNavigating(false);
    setPosition(null);
    setDistance(null);
    // Back to the whole route, which is what the screen is for when
    // nobody is walking.
    setFitToken((t) => t + 1);
  }

  // Replaying the track with a departure induced in the middle stretch.
  useEffect(() => {
    if (!navigating || !replay || track.length === 0) return;
    let i = 0;
    const timer = setInterval(() => {
      const base = track[i % track.length];
      const fraction = (i % track.length) / track.length;
      const departure = fraction > 0.4 && fraction < 0.56 ? 95 : 0;
      process(departure ? offsetPoint(base, departure) : base, i % track.length);
      i += 2;
    }, 700);
    return () => clearInterval(timer);
  }, [navigating, replay, track]);

  // The device's satellite receiver.
  useEffect(() => {
    if (!navigating || replay || track.length === 0) return;
    let sub: Location.LocationSubscription | null = null;
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setPermissionDenied(true);
        return;
      }
      setPermissionDenied(false);
      sub = await Location.watchPositionAsync(
        // distanceInterval of zero is needed to keep receiving readings with
        // the device at rest, which is the condition it is tested under.
        { accuracy: Location.Accuracy.High, distanceInterval: 0, timeInterval: 2000 },
        (l) => {
          setAccuracy(l.coords.accuracy ?? null);
          process({ lat: l.coords.latitude, lon: l.coords.longitude });
        },
      );
    })();
    return () => {
      sub?.remove();
    };
  }, [navigating, replay, track]);

  // Which downloaded region, if any, can draw this track. Resolved once:
  // asking MapLibre on every render would hit the native bridge during the
  // hike, which is the moment the device can least afford it.
  const [styleUrl, setStyleUrl] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    (async () => {
      const ids = await downloadedRegionIds();
      if (active && ids.length > 0) setStyleUrl(styleUrlFor(ids[0]!));
    })();
    return () => {
      active = false;
    };
  }, []);

  async function addReport(kind: string) {
    await saveReport({
      id: `report-${Date.now()}`,
      trailId: String(id),
      kind,
      lat: position?.lat,
      lon: position?.lon,
    });
    setReportsMade((n) => n + 1);
    setShowReportKinds(false);
  }

  if (track.length === 0) {
    return (
      <View style={s.centre}>
        <ActivityIndicator color={c.primary} />
      </View>
    );
  }

  const coveredM = totalDistance(track.slice(0, Math.max(1, progress + 1)));

  return (
    <ScrollView contentContainerStyle={s.content}>
      {offTrack && (
        <View style={s.banner}>
          <Text style={s.bannerTitle}>Te alejaste del sendero</Text>
          <Text style={s.bannerText}>
            {Math.round(distance ?? 0)} m de la traza. Volvé sobre tus pasos.
          </Text>
        </View>
      )}

      <View style={s.canvasBox}>
        <TrackMap
          track={track}
          position={position}
          offTrack={offTrack}
          styleUrl={styleUrl}
          colours={c}
          width={CANVAS.width}
          height={CANVAS.height}
          follow={navigating}
          fitToken={fitToken}
        />
        <Pressable style={s.recentre} onPress={() => setFitToken((t) => t + 1)}>
          <Text style={s.recentreText}>Ver el recorrido completo</Text>
        </Pressable>
      </View>

      <View style={s.metrics}>
        {[
          [distance === null ? '—' : `${Math.round(distance)} m`, 'a la traza', offTrack],
          [`${(walked / 1000).toFixed(2)} km`, 'caminados', false],
          [`${Math.round(((progress + 1) / track.length) * 100)} %`, 'del sendero', false],
        ].map(([v, label, red]) => (
          <View key={String(label)} style={s.metric}>
            <Text style={[s.metricValue, red ? { color: c.danger } : null]}>{String(v)}</Text>
            <Text style={s.metricLabel}>{String(label)}</Text>
          </View>
        ))}
      </View>

      <View style={s.card}>
        <Text style={s.cardText}>
          Radio de tolerancia {TOLERANCE_RADIUS_M} m. La alerta abre tras tres lecturas seguidas
          fuera y cierra tras tres dentro del setenta por ciento del radio.
        </Text>
        <Text style={s.counters}>
          Lecturas procesadas {counters.readings} · consecutivas fuera {counters.outside} ·
          consecutivas dentro {counters.inside}
        </Text>
      </View>

      <Pressable
        style={[s.startButton, navigating && s.stopButton]}
        onPress={navigating ? stop : start}
      >
        <Text style={s.startButtonText}>
          {navigating ? 'Finalizar sendero' : 'Iniciar sendero'}
        </Text>
      </Pressable>

      <Text style={s.sourceDetail}>
        {!navigating
          ? 'El mapa muestra el sendero completo. Al iniciar, la vista te sigue mientras caminás.'
          : replay
            ? 'Recorrido simulado sobre la traza, con un apartamiento inducido.'
            : accuracy !== null
              ? `Siguiendo el receptor del dispositivo. Precisión ${Math.round(accuracy)} m.`
              : 'Esperando la primera lectura del receptor.'}
      </Text>

      {!navigating && (
        // A simulated walk is the only way to exercise the deviation alert
        // without being on the mountain, so it stays available, out of the
        // way of the thing the screen is actually for.
        <View style={s.sourceRow}>
          <View style={{ flex: 1 }}>
            <Text style={s.sourceDetail}>Simular el recorrido en lugar de usar el receptor</Text>
          </View>
          <Switch value={replay} onValueChange={setReplay} />
        </View>
      )}

      {permissionDenied && (
        <Text style={s.permission}>
          Sin permiso de ubicación no se puede usar el receptor. Activalo desde los ajustes del
          teléfono.
        </Text>
      )}

      {!showReportKinds ? (
        <Pressable style={s.button} onPress={() => setShowReportKinds(true)}>
          <Text style={s.buttonText}>Reportar estado del camino</Text>
        </Pressable>
      ) : (
        <View>
          {REPORT_KINDS.map((k) => (
            <Pressable key={k} style={s.reportOption} onPress={() => addReport(k)}>
              <Text style={s.reportText}>{k}</Text>
            </Pressable>
          ))}
        </View>
      )}

      {reportsMade > 0 && (
        <Text style={s.footer}>
          {reportsMade} reporte{reportsMade === 1 ? '' : 's'} guardado
          {reportsMade === 1 ? '' : 's'} y encolado{reportsMade === 1 ? '' : 's'} para sincronizar
        </Text>
      )}
      <Text style={s.footer}>Todo el cálculo se ejecuta en el dispositivo y sin conexión</Text>
    </ScrollView>
  );
}

const styles = (c: Palette) =>
  StyleSheet.create({
    content: { padding: sp.lg, paddingBottom: sp.xl * 2 },
    centre: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    banner: { backgroundColor: c.danger, borderRadius: 10, padding: sp.md, marginBottom: sp.md },
    bannerTitle: { color: '#ffffff', fontWeight: '700', fontSize: 15 },
    bannerText: { color: '#ffffff', fontSize: 13, marginTop: 2 },
    canvasBox: {
      backgroundColor: c.surface,
      borderColor: c.border,
      borderWidth: 1,
      borderRadius: 10,
      alignItems: 'center',
      paddingVertical: sp.sm,
      marginBottom: sp.md,
    },
    recentre: { paddingTop: sp.sm, paddingHorizontal: sp.md },
    startButton: {
      backgroundColor: c.primary,
      borderRadius: 10,
      paddingVertical: sp.md,
      alignItems: 'center',
      marginBottom: sp.sm,
    },
    stopButton: { backgroundColor: c.danger },
    startButtonText: { color: c.onPrimary, fontWeight: '700', fontSize: 15 },
    recentreText: { color: c.primary, fontSize: 12, fontWeight: '700' },
    canvasNote: {
      fontSize: 11,
      color: c.mutedText,
      marginTop: sp.xs,
      paddingHorizontal: sp.md,
      textAlign: 'center',
      lineHeight: 15,
    },
    metrics: { flexDirection: 'row', marginBottom: sp.md },
    metric: { flex: 1, alignItems: 'center' },
    metricValue: { fontSize: 18, fontWeight: '700', color: c.text },
    metricLabel: { fontSize: 11, color: c.mutedText, marginTop: 2 },
    card: {
      backgroundColor: c.surface,
      borderColor: c.border,
      borderWidth: 1,
      borderRadius: 10,
      padding: sp.md,
      marginBottom: sp.md,
    },
    cardText: { fontSize: 12, color: c.mutedText, lineHeight: 17 },
    counters: { fontSize: 12, color: c.primary, marginTop: 6, fontWeight: '600' },
    sourceRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: sp.md,
      backgroundColor: c.primarySoft,
      borderRadius: 10,
      padding: sp.md,
      marginBottom: sp.md,
    },
    sourceTitle: { fontWeight: '700', color: c.primary, fontSize: 13 },
    sourceDetail: { color: c.mutedText, fontSize: 12, marginTop: 2, lineHeight: 17 },
    permission: { color: c.danger, fontSize: 12, marginBottom: sp.md },
    button: { backgroundColor: c.primary, borderRadius: 10, paddingVertical: 14, alignItems: 'center' },
    buttonText: { color: c.onPrimary, fontWeight: '700', fontSize: 14 },
    reportOption: {
      backgroundColor: c.surface,
      borderColor: c.border,
      borderWidth: 1,
      borderRadius: 10,
      padding: sp.md,
      marginBottom: sp.sm,
    },
    reportText: { color: c.text, fontSize: 14, textAlign: 'center' },
    footer: { textAlign: 'center', color: c.mutedText, fontSize: 11, marginTop: sp.sm },
  });
