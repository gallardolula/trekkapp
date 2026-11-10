/** Assisted hike.
 *
 *  The map fills the screen and everything else floats over it. A trail is
 *  walked by looking at where the path goes next, and the previous layout,
 *  a map the size of a postcard above a column of cards, showed a line with
 *  no surroundings. The surroundings are the part that tells somebody where
 *  they are.
 *
 *  Underneath, it continuously evaluates the distance between the hiker's
 *  position and the downloaded track, and applies the deviation rule with
 *  its hysteresis. Two position sources are offered: the device's satellite
 *  receiver, which is what the field uses, and a replay of the track with
 *  an induced departure, which lets the alert be seen opening and clearing
 *  without being on site.
 */
import * as Location from 'expo-location';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  appendHikePoint,
  finishHike,
  listTrailReports,
  listTrails,
  readProfile,
  readTrackPoints,
  recordAlert,
  saveReport,
  startHike,
  type StoredReport,
} from '../../src/data/db';
import { resolveMapSource, type MapSource } from '../../src/data/regions';
import { anchorOnTrack, distanceToTrack, haversineDistance } from '../../src/domain/geo';
import { reportSeverity } from '../../src/domain/reports';
import {
  evaluateAttempt,
  evaluateDeviation,
  evaluateStart,
  START_RADIUS_M,
  TOLERANCE_RADIUS_M,
} from '../../src/domain/rules';
import { totalDistance } from '../../src/domain/trail';
import {
  AttemptDecision,
  DeviationState,
  INITIAL_DEVIATION_STATE,
  Point,
} from '../../src/domain/types';
import { prepareStorage } from '../../src/startup/storage';
import { cameraAvailable, capturePhoto, CameraRefused } from '../../src/data/photos';
import { setRecording } from '../../src/sync/auto';
import BottomSheet, { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { ReportSheet, type ReportPlace } from '../../src/ui/ReportSheet';
import { TrackMap, type MapReport } from '../../src/ui/TrackMap';
import { Palette, sp, useTheme } from '../../src/ui/theme';

/** Shifts a point sideways by a given number of metres. */
function offsetPoint(p: Point, meters: number): Point {
  const degrees = meters / 111_320;
  return { ...p, lat: p.lat + degrees, lon: p.lon + degrees * 0.4 };
}

export default function Hike() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { c } = useTheme();
  const s = useMemo(() => styles(c), [c]);
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();

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
  // Changing these moves the camera: one frames the whole route, the other
  // comes back to the hiker.
  const [fitToken, setFitToken] = useState(0);
  const [centreToken, setCentreToken] = useState(0);
  const [distance, setDistance] = useState<number | null>(null);
  const [progress, setProgress] = useState(0);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [counters, setCounters] = useState({ readings: 0, outside: 0, inside: 0 });
  const [detail, setDetail] = useState(false);

  /**
   * How far up the sheet can be pulled.
   *
   * Collapsed shows the figures and the buttons, which is everything
   * needed while walking. The tallest stop is for the technical detail,
   * and nothing goes beyond it: a sheet that covers the whole map turns
   * the map screen into a different screen.
   */
  const sheet = useRef<BottomSheet>(null);

  // Reporting. The sheet asks what was found; marking a point sends the
  // hiker back to the map with the sheet out of the way, which is the only
  // way to tap a place that the sheet would otherwise be covering.
  const [reports, setReports] = useState<StoredReport[]>([]);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const [place, setPlace] = useState<ReportPlace>({ kind: 'here' });
  const [pick, setPick] = useState<Point | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [photos, setPhotos] = useState(0);

  const state = useRef<DeviationState>(INITIAL_DEVIATION_STATE);

  /**
   * Where the hiker is, before the walk starts.
   *
   * One reading and not a watch. The continuous one only runs while a walk
   * is under way, which left the check on how far away somebody is with
   * nothing to measure: pressing start reported that the receiver had not
   * answered, when what it had not done was been asked.
   *
   * Coarse on purpose. Deciding whether somebody is at the trail or in
   * another city needs nothing better, and the cheap fix comes from the
   * network in a second rather than from satellites in thirty.
   */
  const [here, setHere] = useState<Point | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (!active) return;
      if (status !== 'granted') {
        setPermissionDenied(true);
        return;
      }
      setPermissionDenied(false);
      try {
        const fix = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        if (active) setHere({ lat: fix.coords.latitude, lon: fix.coords.longitude });
      } catch {
        // No fix indoors or with the radio off. The screen says so where
        // it matters, which is when somebody tries to set out.
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  // The trail and the level, which together decide whether setting out
  // needs a confirmation. Read here because this is the screen where
  // somebody sets out, and the question has to be asked at that moment.
  const [attempt, setAttempt] = useState<AttemptDecision | null>(null);

  useEffect(() => {
    prepareStorage()
      .then(() => readTrackPoints(String(id)))
      .then(setTrack);
  }, [id]);

  useEffect(() => {
    let active = true;
    (async () => {
      const [list, hiker] = await Promise.all([listTrails(), readProfile()]);
      const t = list.find((x) => x.id === String(id));
      if (active && t && hiker) setAttempt(evaluateAttempt(t.attributes, hiker.level));
    })();
    return () => {
      active = false;
    };
  }, [id]);

  const refreshReports = useCallback(async () => {
    setReports(await listTrailReports(String(id)));
  }, [id]);

  useEffect(() => {
    void refreshReports();
  }, [refreshReports]);

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
      // Leaving the screen ends the walk however it was left, including by
      // the back gesture, so the flag is cleared here and not only by the
      // button. Otherwise walking away from a recording would keep the
      // device from ever synchronising again.
      setRecording(false);
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

  /**
   * Begins the walk, after the two checks that belong to this moment.
   *
   * Both used to live elsewhere or nowhere. The level check was attached
   * to marking a trail for offline use, so opening a trail beyond your
   * level and pressing start asked nothing; and there was no check at all
   * that the hiker was anywhere near the path.
   */
  async function start() {
    // Where they are. A refusal, because this is a fact rather than a
    // judgement: a walk recorded from another city enters the history as
    // a walk and anchors any report to a path nobody was on.
    if (!replay && permissionDenied) {
      Alert.alert(
        'Necesitamos saber dónde estás',
        'Sin permiso de ubicación no podemos comprobar que estés en el sendero, y lo que se ' +
          'registre no sería lo que caminaste. Activalo desde los ajustes del teléfono, o simulá ' +
          'el recorrido para probar la aplicación.',
        [
          { text: 'Entendido' },
          { text: 'Simular el recorrido', onPress: () => setReplay(true) },
        ],
      );
      return;
    }

    const where = evaluateStart(replay ? track[0]! : (position ?? here), track);
    if (!where.allowed) {
      Alert.alert('Todavía no podés iniciar', where.reason!, [
        { text: 'Entendido' },
        { text: 'Simular el recorrido', onPress: () => setReplay(true) },
      ]);
      return;
    }

    // What they declared. A question and never a refusal, because the
    // person knows things about themselves the application does not.
    if (attempt?.requiresConfirmation && !(await confirmLevel(attempt.reason!))) return;

    recorded.current = { count: 0, metres: 0, deviations: 0, last: null };
    setWalked(0);
    setNavigating(true);
    setCentreToken((t) => t + 1);
    // Nothing reaches for the network from here on. The automatic
    // synchronisation refuses while this is set.
    setRecording(true);
  }

  /** Asks before setting out on something harder than the declared level. */
  function confirmLevel(reason: string): Promise<boolean> {
    return new Promise((resolve) => {
      Alert.alert('Supera tu nivel declarado', `${reason}\n\n¿Querés iniciarlo igual?`, [
        { text: 'Cancelar', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Iniciar igual', style: 'destructive', onPress: () => resolve(true) },
      ]);
    });
  }

  function stop() {
    setRecording(false);
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

  // Which map can be drawn, resolved once. Asking MapLibre on every render
  // would hit the native bridge during the hike, which is the moment the
  // device can least afford it.
  const [map, setMap] = useState<MapSource | null>(null);
  useEffect(() => {
    let active = true;
    (async () => {
      const source = await resolveMapSource(track[0] ?? null);
      if (active) setMap(source);
    })();
    return () => {
      active = false;
    };
  }, [track]);

  /** A tap while marking, snapped onto the path. */
  function onPick(tapped: Point) {
    if (track.length === 0) return;
    const anchor = anchorOnTrack(tapped, track);
    setPick(anchor.point);
    setPlace({ kind: 'onTrack', alongM: anchor.alongM, offTrackM: anchor.offTrackM });
  }

  function confirmPick() {
    setPicking(false);
    setSheetOpen(true);
  }

  function cancelPick() {
    setPicking(false);
    setPick(null);
    setPlace({ kind: 'here' });
    setSheetOpen(true);
  }

  /** A photograph of this walk, kept on the phone and nowhere else. */
  async function takePhoto() {
    const current = hikeId.current;
    if (!current) return;
    try {
      const photo = await capturePhoto(current, position ?? here);
      if (photo) {
        setPhotos((n) => n + 1);
        setSaved('Foto guardada con este recorrido. Queda en tu teléfono.');
        setTimeout(() => setSaved(null), 4000);
      }
    } catch (error) {
      Alert.alert(
        'No pudimos usar la cámara',
        error instanceof CameraRefused
          ? 'Hace falta permiso de cámara. Podés activarlo desde los ajustes del teléfono.'
          : 'Probá de nuevo en un momento.',
      );
    }
  }

  async function saveTheReport(draft: { kindId: string; comment: string }) {
    // Where it goes, in order of what the hiker chose. A report marked on
    // the map is anchored to the path; one left where they stand carries
    // the reading as it came.
    const at = place.kind === 'onTrack' ? pick : position;
    await saveReport({
      trailId: String(id),
      kind: draft.kindId,
      ...(draft.comment ? { comment: draft.comment } : {}),
      ...(at ? { lat: at.lat, lon: at.lon } : {}),
    });
    await refreshReports();
    setSheetOpen(false);
    setPick(null);
    setPlace({ kind: 'here' });
    setSaved('Aviso guardado. Se envía en la próxima sincronización.');
    setTimeout(() => setSaved(null), 4000);
  }

  if (track.length === 0) {
    return (
      <View style={[s.centre, { backgroundColor: c.background }]}>
        <ActivityIndicator color={c.primary} />
      </View>
    );
  }

  const coveredM = totalDistance(track.slice(0, Math.max(1, progress + 1)));
  // How far the hiker is from the path, before setting out.
  const atHand = position ?? here;
  const away = atHand && track.length > 0 ? distanceToTrack(atHand, track).meters : null;
  const pins: MapReport[] = reports
    .filter((r) => typeof r.lat === 'number' && typeof r.lon === 'number')
    .map((r) => ({
      id: r.id,
      lat: r.lat!,
      lon: r.lon!,
      severity: reportSeverity(r.kind),
    }));

  return (
    <View style={s.screen}>
      <TrackMap
        track={track}
        position={position}
        offTrack={offTrack}
        styleUrl={map?.styleUrl ?? null}
        colours={c}
        width={width}
        height={height}
        follow={navigating && !picking}
        fitToken={fitToken}
        centreToken={centreToken}
        reports={pins}
        // The bottom belongs to the panel sitting over the map, so the
        // trail is framed above it rather than behind it.
        fitPadding={{ top: insets.top + 70, right: 50, bottom: 300, left: 50 }}
        picking={picking}
        onPick={onPick}
        pick={pick}
      />

      {/* Floating controls, over the map rather than beside it. */}
      <View style={[s.topBar, { top: insets.top + sp.sm }]}>
        <Pressable style={s.round} onPress={() => router.back()} accessibilityLabel="Volver">
          <Text style={s.roundGlyph}>‹</Text>
        </Pressable>
        <View style={{ flex: 1 }} />
        <Pressable
          style={s.round}
          onPress={() => setFitToken((t) => t + 1)}
          accessibilityLabel="Ver el recorrido completo"
        >
          <Text style={s.roundLabel}>⤢</Text>
        </Pressable>
        <Pressable
          style={[s.round, !position && s.roundOff]}
          onPress={() => setCentreToken((t) => t + 1)}
          disabled={!position}
          accessibilityLabel="Centrar en mi posición"
        >
          <Text style={s.roundLabel}>◎</Text>
        </Pressable>
      </View>

      {offTrack && !picking && (
        <View style={[s.banner, { top: insets.top + 64 }]}>
          <Text style={s.bannerTitle}>Te alejaste del sendero</Text>
          <Text style={s.bannerText}>
            {Math.round(distance ?? 0)} m de la traza. Volvé sobre tus pasos.
          </Text>
        </View>
      )}

      {saved && !picking && (
        <View style={[s.toast, { top: insets.top + 64 }]}>
          <Text style={s.toastText}>{saved}</Text>
        </View>
      )}

      {/* Which map this is cannot be left implicit. A map drawn from the
          network looks exactly like one that is on the phone, and the
          difference only shows up where there is no signal to find out. */}
      {map && !map.offline && !picking && (
        <View style={[s.network, { top: insets.top + 56 }]}>
          <Text style={s.networkText}>
            Mapa en línea. Descargá la región para que siga estando sin señal.
          </Text>
        </View>
      )}

      {picking ? (
        <View style={[s.panel, { paddingBottom: insets.bottom + sp.lg }]}>
          <Text style={s.pickTitle}>Tocá el punto del sendero</Text>
          <Text style={s.pickDetail}>
            {pick
              ? place.kind === 'onTrack'
                ? `Marcado en el km ${(place.alongM / 1000).toFixed(2)} del sendero.`
                : ''
              : 'El aviso se guarda sobre la traza, en el punto más cercano a donde toques.'}
          </Text>
          <View style={s.pickActions}>
            <Pressable
              style={[s.primary, !pick && s.primaryOff]}
              onPress={confirmPick}
              disabled={!pick}
            >
              <Text style={s.primaryText}>Marcar acá</Text>
            </Pressable>
            <Pressable style={s.quiet} onPress={cancelPick}>
              <Text style={s.quietText}>Cancelar</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        // A sheet rather than a fixed panel. The map is the screen, and how
        // much of it the hiker wants to see changes constantly: collapsed
        // while following the path, pulled up to read the figures or the
        // detail. A panel of one height has to choose for them.
        <BottomSheet
          ref={sheet}
          index={0}
          snapPoints={SNAP_POINTS}
          // Off, and it has to be. Version 5 sizes a sheet to its content
          // by default, which fights explicit stops: the sheet moves
          // between them and renders nothing inside.
          enableDynamicSizing={false}
          enablePanDownToClose={false}
          backgroundStyle={{ backgroundColor: c.background }}
          handleIndicatorStyle={{ backgroundColor: c.border, width: 44 }}
          bottomInset={0}
        >
          <BottomSheetScrollView
            contentContainerStyle={[s.sheet, { paddingBottom: insets.bottom + sp.lg }]}
          >
          <View style={s.metrics}>
            {[
              [distance === null ? '—' : `${Math.round(distance)} m`, 'a la traza', offTrack],
              [`${(walked / 1000).toFixed(2)} km`, photos > 0 ? `caminados · ${photos} 📷` : 'caminados', false],
              [
                `${Math.round(((progress + 1) / track.length) * 100)} %`,
                `de ${(coveredM / 1000).toFixed(1)} km`,
                false,
              ],
            ].map(([v, label, red]) => (
              <View key={String(label)} style={s.metric}>
                <Text style={[s.metricValue, red ? { color: c.danger } : null]}>{String(v)}</Text>
                <Text style={s.metricLabel}>{String(label)}</Text>
              </View>
            ))}
          </View>

          {/* Said before anybody tries, rather than as a refusal after.
              Whoever is at home looking at a trail two hours away should
              be able to read that here and not discover it by pressing. */}
          {!navigating && !replay && away !== null && away > START_RADIUS_M && (
            <Text style={s.away}>
              Estás a {away >= 10_000 ? Math.round(away / 1000) : (away / 1000).toFixed(1)} km de
              este sendero. Vas a poder iniciarlo cuando llegues.
            </Text>
          )}

          <View style={s.row}>
            <Pressable
              style={[s.primary, navigating && { backgroundColor: c.danger }]}
              onPress={navigating ? stop : () => void start()}
            >
              <Text style={s.primaryText}>
                {navigating ? 'Finalizar sendero' : 'Iniciar sendero'}
              </Text>
            </Pressable>
            <Pressable style={s.report} onPress={() => setSheetOpen(true)}>
              <Text style={s.reportText}>Avisar</Text>
            </Pressable>
            {/* Only while a walk is being recorded, because a photograph
                belongs to an outing and there is no outing yet. It stays
                on this phone and goes nowhere. */}
            {navigating && cameraAvailable() && (
              <Pressable style={s.report} onPress={() => void takePhoto()}>
                <Text style={s.reportText}>Foto</Text>
              </Pressable>
            )}
          </View>

          <Pressable onPress={() => setDetail((d) => !d)} hitSlop={8}>
            <Text style={s.toggle}>
              {detail ? 'Ocultar el detalle técnico' : 'Ver el detalle técnico'}
            </Text>
          </Pressable>

          {detail && (
            <View style={s.detail}>
              <Text style={s.counters}>
                Lecturas {counters.readings} · consecutivas fuera {counters.outside} · dentro{' '}
                {counters.inside}
              </Text>
              <Text style={s.detailText}>
                {replay
                  ? 'Recorrido simulado sobre la traza, con un apartamiento inducido.'
                  : accuracy !== null
                    ? `Receptor del dispositivo. Precisión ${Math.round(accuracy)} m.`
                    : 'Esperando la primera lectura del receptor.'}
              </Text>
              {!navigating && (
                <View style={s.switchRow}>
                  <Text style={[s.detailText, { flex: 1 }]}>
                    Simular el recorrido en lugar de usar el receptor
                  </Text>
                  <Switch value={replay} onValueChange={setReplay} />
                </View>
              )}
              {permissionDenied && (
                <Text style={s.permission}>
                  Sin permiso de ubicación no se puede usar el receptor. Activalo desde los
                  ajustes del teléfono.
                </Text>
              )}
            </View>
          )}
          </BottomSheetScrollView>
        </BottomSheet>
      )}

      <ReportSheet
        open={sheetOpen}
        hasPosition={position !== null}
        place={place}
        onClose={() => setSheetOpen(false)}
        onPickOnMap={() => {
          setSheetOpen(false);
          setPicking(true);
        }}
        onUseCurrentPosition={() => {
          setPick(null);
          setPlace({ kind: 'here' });
        }}
        onSave={saveTheReport}
      />
    </View>
  );
}

/** Collapsed, opened, and as far as it goes. */
const SNAP_POINTS = ['26%', '48%', '82%'];

const styles = (c: Palette) =>
  StyleSheet.create({
    screen: { flex: 1 },
    centre: { flex: 1, alignItems: 'center', justifyContent: 'center' },

    topBar: {
      position: 'absolute',
      left: sp.lg,
      right: sp.lg,
      flexDirection: 'row',
      gap: sp.sm,
    },
    round: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: c.surface,
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: '#000',
      shadowOpacity: 0.18,
      shadowRadius: 6,
      shadowOffset: { width: 0, height: 2 },
      elevation: 4,
    },
    roundOff: { opacity: 0.45 },
    roundGlyph: { color: c.text, fontSize: 28, lineHeight: 30, marginTop: -4 },
    roundLabel: { color: c.text, fontSize: 19 },

    banner: {
      position: 'absolute',
      left: sp.lg,
      right: sp.lg,
      backgroundColor: c.danger,
      borderRadius: 14,
      padding: sp.md,
    },
    bannerTitle: { color: '#ffffff', fontWeight: '800', fontSize: 15 },
    bannerText: { color: '#ffffff', fontSize: 13, marginTop: 2 },

    toast: {
      position: 'absolute',
      left: sp.lg,
      right: sp.lg,
      backgroundColor: c.surface,
      borderRadius: 14,
      padding: sp.md,
      shadowColor: '#000',
      shadowOpacity: 0.18,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 2 },
      elevation: 4,
    },
    toastText: { color: c.text, fontSize: 13, lineHeight: 18 },

    network: {
      position: 'absolute',
      left: sp.lg,
      right: sp.lg,
      backgroundColor: c.warningSoft,
      borderRadius: 12,
      paddingVertical: sp.sm,
      paddingHorizontal: sp.md,
    },
    networkText: { color: c.warning, fontSize: 12, lineHeight: 17, fontWeight: '600' },

    panel: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: c.background,
      borderTopLeftRadius: 22,
      borderTopRightRadius: 22,
      paddingHorizontal: sp.lg,
      paddingTop: sp.lg,
      maxHeight: '58%',
    },
    sheet: { paddingHorizontal: sp.lg, paddingTop: sp.xs },

    metrics: { flexDirection: 'row', marginBottom: sp.lg },
    metric: { flex: 1, alignItems: 'center' },
    metricValue: { fontSize: 22, fontWeight: '800', color: c.text },
    metricLabel: { fontSize: 11.5, color: c.mutedText, marginTop: 2 },

    row: { flexDirection: 'row', gap: sp.sm },
    primary: {
      flex: 1,
      backgroundColor: c.primary,
      borderRadius: 28,
      paddingVertical: 16,
      alignItems: 'center',
      justifyContent: 'center',
    },
    primaryOff: { opacity: 0.45 },
    primaryText: { color: c.onPrimary, fontWeight: '800', fontSize: 16 },
    report: {
      borderColor: c.primary,
      borderWidth: 1.5,
      borderRadius: 28,
      paddingVertical: 16,
      paddingHorizontal: sp.lg,
      alignItems: 'center',
      justifyContent: 'center',
    },
    reportText: { color: c.primary, fontWeight: '800', fontSize: 15 },

    away: {
      color: c.warning,
      fontSize: 12.5,
      lineHeight: 18,
      marginBottom: sp.md,
      fontWeight: '600',
    },
    toggle: {
      color: c.mutedText,
      fontSize: 12,
      textAlign: 'center',
      marginTop: sp.md,
      fontWeight: '600',
    },
    detail: { marginTop: sp.sm },
    detailText: { fontSize: 12, color: c.mutedText, lineHeight: 17, marginBottom: sp.xs },
    counters: { fontSize: 12, color: c.primary, marginBottom: sp.sm, fontWeight: '600' },
    switchRow: { flexDirection: 'row', alignItems: 'center', gap: sp.md, marginVertical: sp.sm },
    permission: { color: c.danger, fontSize: 12, marginBottom: sp.sm },

    pickTitle: { color: c.text, fontSize: 17, fontWeight: '800' },
    pickDetail: { color: c.mutedText, fontSize: 12.5, lineHeight: 18, marginTop: sp.xs },
    pickActions: { flexDirection: 'row', gap: sp.sm, marginTop: sp.lg, alignItems: 'center' },
    quiet: { paddingVertical: 16, paddingHorizontal: sp.lg },
    quietText: { color: c.mutedText, fontWeight: '700', fontSize: 15 },
  });
