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
import Svg, { Circle, Line, Polyline, Rect } from 'react-native-svg';

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
  const [replay, setReplay] = useState(true);
  const [offTrack, setOffTrack] = useState(false);
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

    const result = evaluateDeviation(r.meters, state.current);
    state.current = result.state;
    setCounters((x) => ({
      readings: x.readings + 1,
      outside: result.state.readingsOutside,
      inside: result.state.readingsInside,
    }));
    if (result.shouldAlert) {
      setOffTrack(true);
      recordAlert({
        trailId: String(id),
        kind: 'deviation',
        detail: `A ${Math.round(r.meters)} m de la traza.`,
      });
    }
    if (result.shouldClearAlert) setOffTrack(false);
  }

  // Switching position source restarts tracking, so readings accumulated with
  // the previous source do not affect the new series.
  useEffect(() => {
    state.current = INITIAL_DEVIATION_STATE;
    setOffTrack(false);
    setDistance(null);
    setAccuracy(null);
    setCounters({ readings: 0, outside: 0, inside: 0 });
  }, [replay]);

  // Replaying the track with a departure induced in the middle stretch.
  useEffect(() => {
    if (!replay || track.length === 0) return;
    let i = 0;
    const timer = setInterval(() => {
      const base = track[i % track.length];
      const fraction = (i % track.length) / track.length;
      const departure = fraction > 0.4 && fraction < 0.56 ? 95 : 0;
      process(departure ? offsetPoint(base, departure) : base, i % track.length);
      i += 2;
    }, 700);
    return () => clearInterval(timer);
  }, [replay, track]);

  // The device's satellite receiver.
  useEffect(() => {
    if (replay || track.length === 0) return;
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
  }, [replay, track]);

  // Linear projection of the track onto the canvas, with the position inside
  // the frame so it never falls out of view.
  const view = useMemo(() => {
    if (track.length === 0) return null;
    const pts = position ? [...track, position] : track;
    const lats = pts.map((p) => p.lat);
    const lons = pts.map((p) => p.lon);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLon = Math.min(...lons);
    const maxLon = Math.max(...lons);
    const latRange = maxLat - minLat || 1e-6;
    const lonRange = maxLon - minLon || 1e-6;
    const w = CANVAS.width - CANVAS.margin * 2;
    const h = CANVAS.height - CANVAS.margin * 2;
    const project = (p: Point) => ({
      x: CANVAS.margin + ((p.lon - minLon) / lonRange) * w,
      y: CANVAS.margin + (1 - (p.lat - minLat) / latRange) * h,
    });
    return {
      line: track.map(project).map((q) => `${q.x.toFixed(1)},${q.y.toFixed(1)}`).join(' '),
      me: position ? project(position) : null,
    };
  }, [track, position]);

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
        <Svg width={CANVAS.width} height={CANVAS.height}>
          <Rect x={0} y={0} width={CANVAS.width} height={CANVAS.height} fill={c.canvas} />
          {[0.2, 0.4, 0.6, 0.8].map((f) => (
            <Line
              key={f}
              x1={0}
              y1={CANVAS.height * f}
              x2={CANVAS.width}
              y2={CANVAS.height * f}
              stroke={c.canvasLine}
              strokeWidth={1}
            />
          ))}
          {view && (
            <Polyline points={view.line} fill="none" stroke={c.danger} strokeWidth={2.5} strokeLinejoin="round" />
          )}
          {view?.me && (
            <>
              <Circle cx={view.me.x} cy={view.me.y} r={13} fill={c.primary} opacity={0.22} />
              <Circle cx={view.me.x} cy={view.me.y} r={6} fill={c.primary} />
            </>
          )}
        </Svg>
        <Text style={s.canvasNote}>
          Vista esquemática de la traza y la posición. La cartografía requiere un development build
          y queda pendiente.
        </Text>
      </View>

      <View style={s.metrics}>
        {[
          [distance === null ? '—' : `${Math.round(distance)} m`, 'a la traza', offTrack],
          [`${(coveredM / 1000).toFixed(1)} km`, 'recorridos', false],
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

      <View style={s.sourceRow}>
        <View style={{ flex: 1 }}>
          <Text style={s.sourceTitle}>
            {replay ? 'Reproducción de la traza' : 'Receptor satelital'}
          </Text>
          <Text style={s.sourceDetail}>
            {replay
              ? 'Recorre la traza e induce un apartamiento para mostrar la alerta.'
              : accuracy !== null
                ? `Posición real del dispositivo. Precisión ${Math.round(accuracy)} m.`
                : 'Esperando la primera lectura del receptor.'}
          </Text>
        </View>
        <Switch value={replay} onValueChange={setReplay} />
      </View>

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
