/** Trail detail and download decision.
 *
 *  Brings together the two warnings that condition the decision: the one
 *  from contrasting difficulty against the declared level, and the one from
 *  evaluating the forecast against the thresholds. When the difficulty
 *  exceeds the level, the download requires an explicit confirmation.
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  listTrails,
  markDownloaded,
  readForecast,
  readProfile,
  readTrackPoints,
  recordAlert,
  saveForecast,
  TrailSummary,
} from '../../src/data/db';
import { fetchForecast } from '../../src/data/weather';
import { evaluateDownload, evaluateWeather } from '../../src/domain/rules';
import { DownloadDecision, Level, Point, WeatherAlert } from '../../src/domain/types';
import { prepareStorage } from '../../src/startup/storage';
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

  const [trail, setTrail] = useState<TrailSummary | null>(null);
  const [points, setPoints] = useState<Point[]>([]);
  const [level, setLevel] = useState<Level | null>(null);
  const [decision, setDecision] = useState<DownloadDecision | null>(null);
  const [weather, setWeather] = useState<WeatherAlert | null>(null);
  const [obtainedAt, setObtainedAt] = useState<string | null>(null);
  const [noForecast, setNoForecast] = useState(false);
  const [downloaded, setDownloaded] = useState(false);

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
      setDownloaded(t.downloadedAt !== null);
      if (p) setDecision(evaluateDownload(t.attributes, p.level));

      // What is already on the device is shown first, so the screen is
      // never empty while the network is being waited on. The server picks
      // the coordinates from the trail's own geometry.
      const today = new Date().toISOString().slice(0, 10);
      const stored = await readForecast(t.id, today);
      if (stored) {
        setWeather(evaluateWeather(stored.forecast));
        setObtainedAt(stored.obtainedAt);
      }
      const fresh = await fetchForecast(t.id);
      if (!active) return;
      if (fresh) {
        await saveForecast(t.id, fresh.forecast);
        setWeather(evaluateWeather(fresh.forecast));
        // The age is the server's, not the moment this device received it.
        // A forecast the server cached three hours ago is three hours old
        // however recently it travelled.
        setObtainedAt(fresh.obtainedAt);
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
    await markDownloaded(trail.id);
    setDownloaded(true);
  }

  if (!trail) {
    return (
      <View style={s.centre}>
        <ActivityIndicator color={c.primary} />
      </View>
    );
  }

  const a = trail.attributes;
  const risky = weather?.severity === 'risk';

  return (
    <ScrollView contentContainerStyle={s.content}>
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

      {noForecast && (
        <View style={[s.notice, { backgroundColor: c.background, borderColor: c.border }]}>
          <Text style={s.noticeText}>
            No se pudo obtener el pronóstico. La descarga sigue disponible, pero sin información
            meteorológica.
          </Text>
        </View>
      )}

      {!downloaded ? (
        <Pressable
          style={[s.button, { backgroundColor: decision?.requiresConfirmation ? c.danger : c.primary }]}
          onPress={confirmDownload}
        >
          <Text style={s.buttonText}>
            {decision?.requiresConfirmation
              ? 'Entiendo el riesgo y quiero descargarlo'
              : 'Descargar para usar sin conexión'}
          </Text>
        </Pressable>
      ) : (
        <Pressable
          style={[s.button, { backgroundColor: c.success }]}
          onPress={() => router.push(`/hike/${trail.id}`)}
        >
          <Text style={s.buttonText}>Ver sendero</Text>
        </Pressable>
      )}

      {decision?.requiresConfirmation && !downloaded && (
        <Text style={s.footer}>Debés confirmar para continuar</Text>
      )}
      {!level && <Text style={s.footer}>Declará tu nivel para recibir advertencias</Text>}
      <Text style={s.footer}>{points.length} puntos en la traza</Text>
    </ScrollView>
  );
}

const styles = (c: Palette) =>
  StyleSheet.create({
    content: { padding: sp.lg, paddingBottom: sp.xl * 2 },
    centre: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    name: { fontSize: 19, fontWeight: '700', color: c.text },
    description: { color: c.mutedText, marginTop: sp.sm, fontSize: 13, lineHeight: 19 },
    metrics: { flexDirection: 'row', marginTop: sp.lg, marginBottom: sp.lg },
    metric: { flex: 1, alignItems: 'center' },
    metricValue: { fontSize: 17, fontWeight: '700', color: c.text, textTransform: 'capitalize' },
    metricLabel: { fontSize: 11, color: c.mutedText, marginTop: 2 },
    notice: { borderWidth: 1, borderRadius: 10, padding: sp.md, marginBottom: sp.md },
    noticeTitle: { fontWeight: '700', fontSize: 14, marginBottom: sp.xs },
    noticeText: { color: c.text, fontSize: 13, lineHeight: 19 },
    source: { color: c.mutedText, fontSize: 11, fontStyle: 'italic', marginTop: sp.sm },
    button: { borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginTop: sp.sm },
    buttonText: { color: '#ffffff', fontWeight: '700', fontSize: 14, textAlign: 'center' },
    footer: { textAlign: 'center', color: c.mutedText, fontSize: 11, marginTop: sp.sm },
  });
