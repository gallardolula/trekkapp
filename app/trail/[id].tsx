/** Trail detail and download decision.
 *
 *  Three questions decide a day out, and the screen is ordered by them: is
 *  this walk within what I said I walk, what is the weather going to do,
 *  and will I still have it when the signal goes. They used to be three
 *  coloured boxes scattered down a column of blocks that all weighed the
 *  same; they are one card at the top now, each line with its own state, so
 *  the decision is made before any scrolling.
 *
 *  Everything underneath is the evidence rather than the decision. How the
 *  trail climbs, the hours ahead on it, and what other people found on the
 *  path, in that order, because that is the order somebody asks for them
 *  once they have decided to go.
 *
 *  Brings together the two warnings that condition the decision: the one
 *  from contrasting difficulty against the declared level, and the one from
 *  evaluating the forecast against the thresholds. When the difficulty
 *  exceeds the level, the download records that the warning was seen.
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ReactNode, useEffect, useMemo, useState } from 'react';
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
  Clock,
  CloudOff,
  CloudRainWind,
  CloudSun,
  CloudUpload,
  Download,
  Expand,
  Gauge,
  Navigation,
  Route,
  Smartphone,
  Trash,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react-native';

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
import { reportLabel, reportSeverity } from '../../src/domain/reports';
import { evaluateAttempt, evaluateWeather } from '../../src/domain/rules';
import { estimatedMinutes } from '../../src/domain/trail';
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
import { reportIcon } from '../../src/ui/reportIcons';
import {
  difficultyColour,
  LEVEL_LABEL,
  Palette,
  severityColour,
  sp,
  useTheme,
} from '../../src/ui/theme';

function age(iso: string): string {
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  return h < 24 ? `hace ${h} h` : `hace ${Math.round(h / 24)} d`;
}

/** An estimate read as a time on a watch rather than as a count of minutes. */
function duration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} h`;
  return `${h} h ${String(m).padStart(2, '0')}`;
}

/** How a line of the decision card is standing. */
type Standing = 'good' | 'warn' | 'bad' | 'plain';

export default function TrailDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { c } = useTheme();
  const s = useMemo(() => styles(c), [c]);
  const colour = difficultyColour(c);
  const severity = severityColour(c);
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

  /** The ink and the tint a line of the decision card is drawn in. */
  function tone(standing: Standing) {
    if (standing === 'bad') return { ink: c.danger, tint: c.dangerSoft };
    if (standing === 'warn') return { ink: c.warning, tint: c.warningSoft };
    if (standing === 'good') return { ink: c.success, tint: c.successSoft };
    // The page behind the card rather than the card itself, so a line
    // with nothing to report still has a disc under its glyph.
    return { ink: c.mutedText, tint: c.background };
  }

  function Line({
    icon: Glyph,
    standing,
    title,
    detail,
    note,
    last,
  }: {
    icon: LucideIcon;
    standing: Standing;
    title: string;
    detail?: ReactNode;
    note?: string;
    last?: boolean;
  }) {
    const { ink, tint } = tone(standing);
    return (
      <View style={[s.line, last && s.lineLast]}>
        <View style={[s.lineBadge, { backgroundColor: tint }]}>
          <Glyph size={18} color={ink} strokeWidth={2.2} />
        </View>
        <View style={s.lineBody}>
          <Text style={[s.lineTitle, { color: standing === 'plain' ? c.text : ink }]}>
            {title}
          </Text>
          {detail}
          {!!note && <Text style={s.lineNote}>{note}</Text>}
        </View>
      </View>
    );
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
  const minutes = estimatedMinutes(a.distanceM, a.elevationGainM);

  const facts: { icon: LucideIcon; value: string; label: string }[] = [
    { icon: Route, value: `${(a.distanceM / 1000).toFixed(1)} km`, label: 'Distancia' },
    { icon: TrendingUp, value: `${Math.round(a.elevationGainM)} m`, label: 'Desnivel' },
    { icon: Clock, value: duration(minutes), label: 'Tiempo estimado' },
  ];

  return (
    <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
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
            height={232}
            interactive={false}
          />
        ) : (
          <TrailArt
            track={points}
            colours={c}
            width={width - sp.lg * 2}
            height={232}
            tint={colour[a.difficulty]}
          />
        )}

        <View style={s.heroExpand}>
          <Expand size={16} color="#ffffff" strokeWidth={2.4} />
        </View>

        {/* The name sits on the picture rather than under it, which is what
            makes the two one object instead of a drawing followed by a
            caption. */}
        <View style={s.heroFoot}>
          <View style={[s.heroPill, { backgroundColor: colour[a.difficulty] }]}>
            <Gauge size={12} color="#ffffff" strokeWidth={2.6} />
            <Text style={s.heroPillText}>{LEVEL_LABEL[a.difficulty]}</Text>
          </View>
          <Text style={s.heroName} numberOfLines={2}>
            {trail.name}
          </Text>
        </View>
      </Pressable>

      {/* Only when the catalogue carries one, and never a block holding a
          string of spaces. */}
      {!!trail.description?.trim() && (
        <Text style={s.description}>{trail.description.trim()}</Text>
      )}

      <View style={s.facts}>
        {facts.map(({ icon: Glyph, value, label }) => (
          <View key={label} style={s.fact}>
            <Glyph size={16} color={c.mutedText} strokeWidth={2.2} />
            <Text style={s.factValue}>{value}</Text>
            <Text style={s.factLabel}>{label}</Text>
          </View>
        ))}
      </View>

      {/* The three things somebody weighs before setting out, together and
          in one glance, instead of three notices separated by charts. */}
      <Text style={s.sectionTitle}>Antes de salir</Text>
      {/* One glyph per subject rather than one per state, so a line is
          recognised before it is read and the colour is left to say how it
          stands. */}
      <View style={s.card}>
        {decision?.requiresConfirmation ? (
          <Line
            icon={Gauge}
            standing="bad"
            title="Supera tu nivel declarado"
            detail={<Text style={s.lineText}>{decision.reason}</Text>}
          />
        ) : level ? (
          <Line icon={Gauge} standing="good" title={`Va con tu nivel ${LEVEL_LABEL[level]}`} />
        ) : (
          <Line icon={Gauge} standing="plain" title="Todavía no declaraste tu nivel" />
        )}

        {noForecast ? (
          <Line icon={CloudOff} standing="plain" title="Sin pronóstico" />
        ) : weather && weather.severity !== 'none' ? (
          <Line
            icon={CloudRainWind}
            standing={risky ? 'bad' : 'warn'}
            title={risky ? 'Riesgo meteorológico' : 'Advertencia meteorológica'}
            detail={weather.reasons.map((r) => (
              <Text key={r} style={s.lineText}>
                {r}
              </Text>
            ))}
            {...(obtainedAt ? { note: age(obtainedAt) } : {})}
          />
        ) : weather ? (
          <Line
            icon={CloudSun}
            standing="good"
            title="Sin alertas meteorológicas"
            {...(obtainedAt ? { note: age(obtainedAt) } : {})}
          />
        ) : (
          <Line icon={CloudSun} standing="plain" title="Buscando el pronóstico" />
        )}

        {busy ? (
          <Line
            icon={Download}
            standing="plain"
            title={`Bajando el mapa, ${Math.round(progress)} %`}
            last
          />
        ) : downloaded ? (
          <Line icon={Smartphone} standing="good" title="Listo para usar sin conexión" last />
        ) : (
          <Line
            icon={Smartphone}
            standing="plain"
            title="El mapa todavía no está en el teléfono"
            last
          />
        )}
      </View>

      {/* Seeing the trail never depends on having downloaded it. The
          download is about keeping it when the signal goes, which is a
          different decision and belongs beside the first rather than in
          front of it. */}
      <Pressable
        style={[s.primary, { backgroundColor: c.primary }]}
        onPress={() => router.push(`/hike/${trail.id}`)}
      >
        <Navigation size={17} color={c.onPrimary} strokeWidth={2.4} />
        <Text style={[s.primaryText, { color: c.onPrimary }]}>Ver sendero</Text>
      </Pressable>

      {busy ? (
        <View style={s.downloadState}>
          <ActivityIndicator color={c.primary} size="small" />
          <Text style={s.downloadText}>
            Bajando el mapa de este sendero… {Math.round(progress)} %
          </Text>
        </View>
      ) : downloaded ? (
        <Pressable
          style={s.quiet}
          onPress={async () => {
            await removeTrail(trail.id);
            setDownloaded(false);
          }}
          hitSlop={8}
        >
          <Trash size={15} color={c.mutedText} strokeWidth={2.2} />
          <Text style={s.quietText}>Eliminar el mapa del teléfono</Text>
        </Pressable>
      ) : (
        <Pressable style={s.secondary} onPress={confirmDownload}>
          <Download size={17} color={c.primary} strokeWidth={2.4} />
          <Text style={s.secondaryText}>Descargar el mapa de este sendero</Text>
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

      {/* How the walk is distributed, which the three numbers above cannot
          say. Six flat kilometres and then a wall add up to the same
          distance and the same ascent as a steady morning's climb. */}
      {profile && (
        <>
          <Text style={s.sectionTitle}>Cómo sube</Text>
          <View style={s.card}>
            <TrailProfile profile={profile} colours={c} width={width - sp.lg * 2 - sp.md * 2} />
          </View>
        </>
      )}

      {hours.length > 0 && (
        <>
          <Text style={s.sectionTitle}>Las próximas horas en el sendero</Text>
          <View style={[s.card, s.weatherCard]}>
            <WeatherStrip hours={hours} obtainedAt={obtainedAt} />
          </View>
        </>
      )}

      <Text style={s.sectionTitle}>Estado del camino</Text>
      {reports.length === 0 ? (
        <View style={s.card}>
          <StateView kind="empty" compact title="Nadie informó nada todavía" />
        </View>
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
          // The same drawing and the same colour the sheet offered when
          // somebody left it, so a report is recognised and not read.
          const mark = severity[reportSeverity(r.kind)];
          const Glyph = reportIcon(r.kind);

          return (
            <View key={r.id} style={[s.report, { borderLeftColor: mark.ink }]}>
              <View style={[s.reportBadge, { backgroundColor: mark.tint }]}>
                <Glyph size={18} color={mark.ink} strokeWidth={2.2} />
              </View>
              <View style={s.reportBody}>
                <View style={s.reportHead}>
                  <Text style={s.reportKind}>{reportLabel(r.kind)}</Text>
                  <Text style={s.reportDate}>{fecha}</Text>
                </View>
                {at && (
                  <Text style={s.reportWhere}>
                    En el km {(at.alongM / 1000).toFixed(2)} del sendero
                  </Text>
                )}
                {r.comment ? <Text style={s.reportComment}>{r.comment}</Text> : null}
                {/* A report still queued is shown as such. Presenting it as
                    shared would suggest others can already see it. */}
                {r.pending && (
                  <View style={s.pending}>
                    <CloudUpload size={12} color={c.mutedText} strokeWidth={2.2} />
                    <Text style={s.pendingText}>Todavía sin sincronizar</Text>
                  </View>
                )}
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
    centre: { flex: 1, alignItems: 'center', justifyContent: 'center' },

    hero: { borderRadius: 22, overflow: 'hidden' },
    heroExpand: {
      position: 'absolute',
      top: sp.md,
      right: sp.md,
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: '#00000073',
      alignItems: 'center',
      justifyContent: 'center',
    },
    heroFoot: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      gap: sp.sm,
      alignItems: 'flex-start',
      paddingHorizontal: sp.md,
      paddingTop: sp.xl,
      paddingBottom: sp.md,
      backgroundColor: '#00000073',
    },
    heroPill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      borderRadius: 12,
      paddingHorizontal: sp.sm,
      paddingVertical: 4,
    },
    heroPillText: {
      color: '#ffffff',
      fontSize: 10.5,
      fontWeight: '800',
      letterSpacing: 0.7,
      textTransform: 'uppercase',
    },
    heroName: { color: '#ffffff', fontSize: 24, fontWeight: '800', lineHeight: 29 },

    description: { color: c.mutedText, marginTop: sp.md, fontSize: 13.5, lineHeight: 20 },

    facts: { flexDirection: 'row', gap: sp.sm, marginTop: sp.lg },
    fact: {
      flex: 1,
      gap: 3,
      alignItems: 'center',
      backgroundColor: c.surface,
      borderColor: c.border,
      borderWidth: 1,
      borderRadius: 18,
      paddingVertical: sp.md,
      paddingHorizontal: sp.sm,
    },
    factValue: { color: c.text, fontSize: 17, fontWeight: '800' },
    factLabel: { color: c.mutedText, fontSize: 10.5, textAlign: 'center' },

    sectionTitle: {
      color: c.text,
      fontWeight: '800',
      fontSize: 12,
      letterSpacing: 0.6,
      textTransform: 'uppercase',
      marginTop: sp.xl,
      marginBottom: sp.sm,
    },
    card: {
      backgroundColor: c.surface,
      borderColor: c.border,
      borderWidth: 1,
      borderRadius: 20,
      padding: sp.md,
    },
    weatherCard: { paddingHorizontal: sp.lg, overflow: 'hidden' },

    line: {
      flexDirection: 'row',
      gap: sp.md,
      paddingBottom: sp.md,
      marginBottom: sp.md,
      borderBottomColor: c.border,
      borderBottomWidth: 1,
    },
    lineLast: { paddingBottom: 0, marginBottom: 0, borderBottomWidth: 0 },
    lineBadge: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
    },
    lineBody: { flex: 1, gap: 2 },
    lineTitle: { fontSize: 14.5, fontWeight: '800' },
    lineText: { color: c.text, fontSize: 12.5, lineHeight: 18 },
    lineNote: { color: c.mutedText, fontSize: 11, marginTop: 2 },

    primary: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: sp.sm,
      borderRadius: 28,
      paddingVertical: 16,
      marginTop: sp.lg,
    },
    primaryText: { fontWeight: '700', fontSize: 15.5 },
    secondary: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: sp.sm,
      borderColor: c.primary,
      borderWidth: 1.5,
      borderRadius: 28,
      paddingVertical: 15,
      marginTop: sp.sm,
    },
    secondaryText: { color: c.primary, fontWeight: '700', fontSize: 14.5 },
    quiet: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      paddingVertical: sp.md,
      marginTop: sp.xs,
    },
    quietText: { color: c.mutedText, fontSize: 12.5, fontWeight: '600' },
    downloadState: { alignItems: 'center', gap: sp.xs, marginTop: sp.md },
    downloadText: { color: c.mutedText, fontSize: 12.5 },

    report: {
      flexDirection: 'row',
      gap: sp.md,
      backgroundColor: c.surface,
      borderColor: c.border,
      borderWidth: 1,
      borderLeftWidth: 4,
      borderRadius: 16,
      padding: sp.md,
      marginBottom: sp.sm,
    },
    reportBadge: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
    },
    reportBody: { flex: 1 },
    reportHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    reportKind: { color: c.text, fontWeight: '800', fontSize: 14 },
    reportDate: { color: c.mutedText, fontSize: 11 },
    reportWhere: { color: c.primary, fontSize: 11.5, marginTop: 2, fontWeight: '700' },
    reportComment: { color: c.mutedText, fontSize: 12.5, marginTop: sp.xs, lineHeight: 18 },
    pending: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: sp.sm },
    pendingText: { color: c.mutedText, fontSize: 10.5, fontWeight: '600' },

  });
