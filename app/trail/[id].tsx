/** Trail detail and download decision.
 *
 *  Brings together the two warnings that condition the decision: the one
 *  from contrasting difficulty against the declared level, and the one from
 *  evaluating the forecast against the thresholds. When the difficulty
 *  exceeds the level, the download requires an explicit confirmation.
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
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
  listTrails,
  markDownloaded,
  listTrailReports,
  readForecast,
  type StoredReport,
  readProfile,
  readTrackPoints,
  recordAlert,
  saveForecast,
  TrailSummary,
} from '../../src/data/db';
import { fetchWeather } from '../../src/data/weather';
import { WeatherStrip } from '../../src/ui/WeatherStrip';
import { anchorOnTrack } from '../../src/domain/geo';
import { reportLabel } from '../../src/domain/reports';
import { evaluateAttempt, evaluateWeather } from '../../src/domain/rules';
import {
  AttemptDecision,
  HourlyForecast,
  Level,
  Point,
  WeatherAlert,
} from '../../src/domain/types';
import { prepareStorage } from '../../src/startup/storage';
import {
  downloadedTrailIds,
  downloadTrail,
  regionFor,
  removeTrail,
  resolveMapSource,
  type MapSource,
} from '../../src/data/regions';
import { buildProfile } from '../../src/domain/profile';
import { TrailArt } from '../../src/ui/TrailArt';
import { TrailProfile } from '../../src/ui/TrailProfile';
import { StateView } from '../../src/ui/StateView';
import { TrackMap } from '../../src/ui/TrackMap';
import { difficultyColour, LEVEL_LABEL, Palette, sp, useTheme } from '../../src/ui/theme';

function age(iso: string): string {
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  return h < 24 ? `hace ${h} h` : `hace ${Math.round(h / 24)} d`;
}

export default function TrailDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { c } = useTheme();
  const s = useMemo(() => styles(c), [c]);
  const colour = difficultyColour(c);
  const { width } = useWindowDimensions();

  const [trail, setTrail] = useState<TrailSummary | null>(null);
  const [points, setPoints] = useState<Point[]>([]);
  const [level, setLevel] = useState<Level | null>(null);
  const [decision, setDecision] = useState<AttemptDecision | null>(null);
  const [weather, setWeather] = useState<WeatherAlert | null>(null);
  const [obtainedAt, setObtainedAt] = useState<string | null>(null);
  const [noForecast, setNoForecast] = useState(false);
  const [hours, setHours] = useState<HourlyForecast[]>([]);
  const [reports, setReports] = useState<StoredReport[]>([]);
  const [downloaded, setDownloaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [failure, setFailure] = useState<string | null>(null);
  const [map, setMap] = useState<MapSource | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      await prepareStorage();
      const list = await listTrails();
      const t = list.find((x) => x.id === id) ?? null;
      const pts = t ? await readTrackPoints(t.id) : [];
      const p = await readProfile();
      if (!active || !t) return;

      setTrail(t);
      setPoints(pts);
      setLevel(p?.level ?? null);
      // What the phone actually holds, not what a flag once recorded. The
      // two disagree on a device where somebody deleted the map.
      const held = await downloadedTrailIds();
      setDownloaded(held.includes(t.id));
      if (p) setDecision(evaluateAttempt(t.attributes, p.level));
      setReports(await listTrailReports(t.id));

      // The map is a bonus here and never a condition. The shape of the
      // walk and its profile are drawn from what is already on the device,
      // so the screen says something useful with no network at all.
      void resolveMapSource(pts[0] ?? null).then((source) => {
        if (active) setMap(source);
      });

      // What is already on the device is shown first, so the screen is
      // never empty while the network is being waited on. The server picks
      // the coordinates from the trail's own geometry.
      const today = new Date().toISOString().slice(0, 10);
      const stored = await readForecast(t.id, today);
      if (stored) {
        setWeather(evaluateWeather(stored.forecast));
        setObtainedAt(stored.obtainedAt);
      }
      const fresh = await fetchWeather(t.id);
      if (!active) return;
      setHours(fresh.hours);
      if (fresh.today) {
        await saveForecast(t.id, fresh.today.forecast);
        setWeather(evaluateWeather(fresh.today.forecast));
        // The age is the server's, not the moment this device received it.
        // A forecast the server cached three hours ago is three hours old
        // however recently it travelled.
        setObtainedAt(fresh.today.obtainedAt);
      } else if (!stored) {
        setNoForecast(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [id]);

  async function confirmDownload() {
    if (!trail) return;
    if (decision?.requiresConfirmation) {
      await recordAlert({
        trailId: trail.id,
        kind: 'level',
        detail: decision.reason,
        accepted: true,
      });
    }
    if (weather && weather.severity !== 'none') {
      await recordAlert({
        trailId: trail.id,
        kind: 'weather',
        detail: weather.reasons.join(' '),
        accepted: true,
      });
    }
    // The tiles themselves, which is what the word has meant to anybody
    // reading it all along. Until now this marked a flag and fetched
    // nothing, and the only way to have a map on the mountain was to
    // download the whole region from the profile.
    setBusy(true);
    setFailure(null);
    try {
      const region = await regionFor(points[0]!);
      if (!region) {
        setFailure('No pudimos averiguar de qué región bajar el mapa. Probá con conexión.');
        return;
      }
      await downloadTrail(trail, points, region, (p) => setProgress(p.percentage));
      await markDownloaded(trail.id);
      setDownloaded(true);
    } catch (error) {
      setFailure(error instanceof Error ? error.message : 'La descarga no pudo completarse.');
    } finally {
      setBusy(false);
    }
  }

  if (!trail) {
    return (
      <View style={s.centre}>
        <ActivityIndicator color={c.primary} />
      </View>
    );
  }

  const a = trail.attributes;
  // Built from what the device already holds, so it costs no network and
  // appears on a fresh install with the preloaded catalogue.
  const profile = buildProfile(points);
  const risky = weather?.severity === 'risk';

  return (
    <ScrollView contentContainerStyle={s.content}>
      {/* The walk itself, before any number about it. A trail nobody has
          seen is a row in a list, and somebody deciding whether to spend a
          day on it is deciding blind. The map is drawn when there is one,
          from the phone or from the network, and the shape of the track is
          drawn when there is not, which is always. */}
      {/* A preview, and it says so by opening the real thing when pressed.
          A map this size that answers gestures swallows the scroll of the
          page it sits in and shows no more of the trail than it already
          does; the full screen one zooms, follows and records. */}
      <Pressable style={s.hero} onPress={() => router.push(`/hike/${trail.id}`)}>
        {map ? (
          <TrackMap
            track={points}
            position={null}
            offTrack={false}
            styleUrl={map.styleUrl}
            colours={c}
            width={width - sp.lg * 2}
            height={210}
            interactive={false}
          />
        ) : (
          <TrailArt
            track={points}
            colours={c}
            width={width - sp.lg * 2}
            height={210}
            tint={colour[a.difficulty]}
          />
        )}
        <View style={s.heroHint}>
          <Text style={s.heroHintText}>Tocá para ver el sendero en pantalla completa</Text>
        </View>
      </Pressable>
      {map && !map.offline && (
        <Text style={s.online}>
          Mapa en línea. Descargá la región desde tu perfil para que siga estando sin señal.
        </Text>
      )}

      <Text style={s.name}>{trail.name}</Text>
      {!!trail.description && <Text style={s.description}>{trail.description}</Text>}

      <View style={s.metrics}>
        {[
          [`${(a.distanceM / 1000).toFixed(1)} km`, 'Distancia', false],
          [`${Math.round(a.elevationGainM)} m`, 'Desnivel', false],
          [LEVEL_LABEL[a.difficulty], 'Exigencia', true],
        ].map(([v, label, tinted]) => (
          <View key={String(label)} style={s.metric}>
            <Text style={[s.metricValue, tinted ? { color: colour[a.difficulty] } : null]}>
              {String(v)}
            </Text>
            <Text style={s.metricLabel}>{String(label)}</Text>
          </View>
        ))}
      </View>

      {/* How the walk is distributed, which the three numbers above cannot
          say. Six flat kilometres and then a wall add up to the same
          distance and the same ascent as a steady morning's climb. */}
      {profile ? (
        <>
          <Text style={s.sectionTitle}>Cómo sube</Text>
          <TrailProfile profile={profile} colours={c} width={width - sp.lg * 2} />
        </>
      ) : (
        points.length > 0 && (
          <Text style={s.footer}>
            Esta traza no trae alturas, así que no podemos mostrar cómo sube.
          </Text>
        )
      )}

      {decision?.requiresConfirmation && (
        <View style={[s.notice, { backgroundColor: c.dangerSoft, borderColor: c.danger }]}>
          <Text style={[s.noticeTitle, { color: c.danger }]}>Supera tu nivel declarado</Text>
          <Text style={s.noticeText}>{decision.reason}</Text>
        </View>
      )}

      {weather && weather.severity !== 'none' && (
        <View
          style={[
            s.notice,
            {
              backgroundColor: risky ? c.dangerSoft : c.warningSoft,
              borderColor: risky ? c.danger : c.warning,
            },
          ]}
        >
          <Text style={[s.noticeTitle, { color: risky ? c.danger : c.warning }]}>
            {risky ? 'Riesgo meteorológico' : 'Advertencia meteorológica'}
          </Text>
          {weather.reasons.map((r) => (
            <Text key={r} style={s.noticeText}>
              {r}
            </Text>
          ))}
          {!!obtainedAt && <Text style={s.source}>Pronóstico obtenido {age(obtainedAt)}</Text>}
        </View>
      )}

      {weather?.severity === 'none' && (
        <View style={[s.notice, { backgroundColor: c.successSoft, borderColor: c.success }]}>
          <Text style={[s.noticeTitle, { color: c.success }]}>Sin alertas meteorológicas</Text>
          {!!obtainedAt && <Text style={s.source}>Pronóstico obtenido {age(obtainedAt)}</Text>}
        </View>
      )}

      {hours.length > 0 && (
        <View style={s.weatherStrip}>
          <WeatherStrip hours={hours} obtainedAt={obtainedAt} />
        </View>
      )}

      {noForecast && (
        <View style={[s.notice, { backgroundColor: c.background, borderColor: c.border }]}>
          <Text style={s.noticeText}>
            No se pudo obtener el pronóstico. La descarga sigue disponible, pero sin información
            meteorológica.
          </Text>
        </View>
      )}

      {/* Seeing the trail never depends on having downloaded it. The
          download is about keeping it when the signal goes, which is a
          different decision and belongs beside the first rather than in
          front of it. */}
      <Pressable style={[s.button, { backgroundColor: c.primary }]} onPress={() => router.push(`/hike/${trail.id}`)}>
        <Text style={s.buttonText}>Ver sendero</Text>
      </Pressable>

      {busy ? (
        <View style={s.downloadState}>
          <ActivityIndicator color={c.primary} size="small" />
          <Text style={s.downloadText}>Bajando el mapa de este sendero… {Math.round(progress)} %</Text>
        </View>
      ) : downloaded ? (
        <View style={s.downloadState}>
          <Text style={s.downloadDone}>Listo para usar sin conexión</Text>
          <Pressable
            onPress={async () => {
              await removeTrail(trail.id);
              setDownloaded(false);
            }}
            hitSlop={8}
          >
            <Text style={s.downloadRemove}>Eliminar el mapa del teléfono</Text>
          </Pressable>
        </View>
      ) : (
        <Pressable style={s.secondaryButton} onPress={confirmDownload}>
          <Text style={s.secondaryButtonText}>Descargar el mapa de este sendero</Text>
        </Pressable>
      )}

      {failure && (
        <StateView
          kind="failed"
          compact
          title="No pudimos bajar el mapa"
          detail={failure}
          action={{ label: 'Volver a intentar', onPress: () => void confirmDownload() }}
        />
      )}

      {decision?.requiresConfirmation && !downloaded && (
        <Text style={s.footer}>Debés confirmar para continuar</Text>
      )}
      {!level && <Text style={s.footer}>Declará tu nivel para recibir advertencias</Text>}

      <Text style={s.sectionTitle}>Estado del camino</Text>
      {reports.length === 0 ? (
        <StateView
          kind="empty"
          compact
          title="Nadie informó nada todavía"
          detail="Los avisos de otras personas llegan al sincronizar, y los tuyos se envían solos cuando vuelva la señal."
        />
      ) : (
        reports.map((r) => {
          const fecha = new Date(r.createdAt).toLocaleDateString('es-AR', {
            day: 'numeric',
            month: 'short',
          });
          // Where on the path it was left, which is the part somebody
          // walking can act on. A coordinate tells them nothing; the
          // kilometre tells them when to start paying attention.
          const at =
            typeof r.lat === 'number' && typeof r.lon === 'number' && points.length > 0
              ? anchorOnTrack({ lat: r.lat, lon: r.lon }, points)
              : null;

          return (
            <View key={r.id} style={s.report}>
              <View style={s.reportHead}>
                <Text style={s.reportKind}>{reportLabel(r.kind)}</Text>
                <Text style={s.reportDate}>
                  {fecha}
                  {/* A report still queued is shown as such. Presenting it as
                      shared would suggest others can already see it. */}
                  {r.pending ? ' · sin sincronizar' : ''}
                </Text>
              </View>
              {at && (
                <Text style={s.reportWhere}>
                  En el km {(at.alongM / 1000).toFixed(2)} del sendero
                </Text>
              )}
              {r.comment ? <Text style={s.reportComment}>{r.comment}</Text> : null}
            </View>
          );
        })
      )}

      <Text style={s.footer}>{points.length} puntos en la traza</Text>
    </ScrollView>
  );
}

const styles = (c: Palette) =>
  StyleSheet.create({
    hero: { borderRadius: 18, overflow: 'hidden', marginBottom: sp.md },
    weatherStrip: { marginTop: sp.lg, marginBottom: sp.md },
    downloadState: { alignItems: 'center', gap: sp.xs, marginTop: sp.md },
    downloadText: { color: c.mutedText, fontSize: 12.5 },
    downloadDone: { color: c.success, fontSize: 13, fontWeight: '700' },
    downloadRemove: { color: c.mutedText, fontSize: 12, marginTop: sp.xs },
    secondaryButton: {
      borderColor: c.primary,
      borderWidth: 1.5,
      borderRadius: 26,
      paddingVertical: 14,
      alignItems: 'center',
      marginTop: sp.sm,
    },
    secondaryButtonText: { color: c.primary, fontWeight: '700', fontSize: 14.5 },
    heroHint: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: '#00000055',
      paddingVertical: sp.sm,
      paddingHorizontal: sp.md,
    },
    heroHintText: { color: '#ffffff', fontSize: 11.5, fontWeight: '600', textAlign: 'center' },
    online: { color: c.warning, fontSize: 11.5, lineHeight: 16, marginBottom: sp.md },
    content: { padding: sp.lg, paddingBottom: sp.xl * 2 },
    centre: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    name: { fontSize: 19, fontWeight: '700', color: c.text },
    description: { color: c.mutedText, marginTop: sp.sm, fontSize: 13, lineHeight: 19 },
    metrics: { flexDirection: 'row', marginTop: sp.lg, marginBottom: sp.lg },
    metric: { flex: 1, alignItems: 'center' },
    metricValue: { fontSize: 17, fontWeight: '700', color: c.text, textTransform: 'capitalize' },
    metricLabel: { fontSize: 11, color: c.mutedText, marginTop: 2 },
    sectionTitle: {
      color: c.text,
      fontWeight: '700',
      fontSize: 13,
      marginTop: sp.lg,
      marginBottom: sp.sm,
    },
    empty: { color: c.mutedText, fontSize: 12, lineHeight: 17 },
    report: {
      borderColor: c.border,
      borderWidth: 1,
      borderRadius: 8,
      padding: sp.md,
      marginBottom: sp.sm,
    },
    reportHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    reportKind: { color: c.text, fontWeight: '700', fontSize: 13, textTransform: 'capitalize' },
    reportDate: { color: c.mutedText, fontSize: 11 },
    reportWhere: { color: c.primary, fontSize: 11.5, marginTop: 2, fontWeight: '600' },
    reportComment: { color: c.mutedText, fontSize: 12, marginTop: sp.xs, lineHeight: 17 },
    notice: { borderWidth: 1, borderRadius: 10, padding: sp.md, marginBottom: sp.md },
    noticeTitle: { fontWeight: '700', fontSize: 14, marginBottom: sp.xs },
    noticeText: { color: c.text, fontSize: 13, lineHeight: 19 },
    source: { color: c.mutedText, fontSize: 11, fontStyle: 'italic', marginTop: sp.sm },
    button: { borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginTop: sp.sm },
    buttonText: { color: '#ffffff', fontWeight: '700', fontSize: 14, textAlign: 'center' },
    footer: { textAlign: 'center', color: c.mutedText, fontSize: 11, marginTop: sp.sm },
  });
