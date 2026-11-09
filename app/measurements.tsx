/** The two requirements that can only be answered on a device.
 *
 *  RNF02 puts a budget on evaluating a position against the track and RNF04
 *  on what an hour of navigation costs in battery. Both were stated and
 *  neither was measured, which is the easiest kind of claim to make and the
 *  hardest to defend.
 *
 *  The first runs here and finishes in seconds. The second cannot: it needs
 *  the phone to be carried with the screen off for long enough that the
 *  reading means something, so this screen starts a session, survives the
 *  screen being locked, and gives the rate when it is stopped.
 *
 *  Deliberately plain. It is an instrument and not a feature, and the
 *  numbers it reports go into the document rather than in front of a hiker.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  batteryAvailable,
  read as readBattery,
  resultOf,
  RNF04_BUDGET_PER_HOUR,
  sample,
  startSession,
  type Sample,
  type SessionResult,
} from '../src/data/battery';
import {
  report,
  RNF02_BUDGET_MS,
  RNF02_POINTS,
  type Timing,
} from '../src/domain/benchmark';
import { Button } from '../src/ui/forms';
import { Palette, sp, useTheme } from '../src/ui/theme';

/** How often a reading is taken while this screen is awake. */
const SAMPLE_EVERY_MS = 60_000;

export default function Measurements() {
  const { c } = useTheme();
  const s = useMemo(() => styles(c), [c]);

  const [timings, setTimings] = useState<Timing[] | null>(null);
  const [running, setRunning] = useState(false);

  const [session, setSession] = useState<string | null>(null);
  const [latest, setLatest] = useState<Sample | null>(null);
  const [result, setResult] = useState<SessionResult | null>(null);

  useEffect(() => {
    void readBattery().then(setLatest);
  }, []);

  // While this screen is awake it keeps sampling. A locked phone stops the
  // timer and costs resolution, not the measurement: the rate is taken from
  // the first and last readings, and one is written the moment the session
  // is stopped.
  useEffect(() => {
    if (!session) return;
    const timer = setInterval(() => {
      void sample(session).then((s) => s && setLatest(s));
    }, SAMPLE_EVERY_MS);
    return () => clearInterval(timer);
  }, [session]);

  const measureSpeed = useCallback(() => {
    setRunning(true);
    // Yielded to the next frame so the button paints its busy state before
    // the thread is taken for the length of the benchmark.
    setTimeout(() => {
      setTimings(report());
      setRunning(false);
    }, 50);
  }, []);

  async function begin() {
    setResult(null);
    const started = await startSession();
    setSession(started);
    if (started) setLatest(await readBattery());
  }

  async function finish() {
    if (!session) return;
    await sample(session);
    setResult(await resultOf(session));
    setSession(null);
  }

  return (
    <ScrollView contentContainerStyle={s.content}>
      <Text style={s.title}>RNF02. Evaluación de la posición</Text>
      <Text style={s.detail}>
        Presupuesto de {RNF02_BUDGET_MS} ms contra una traza de {RNF02_POINTS} puntos. Esta medición
        corre en este teléfono, que es donde el requerimiento aplica.
      </Text>

      <Button
        label={running ? 'Midiendo…' : 'Medir'}
        onPress={measureSpeed}
        busy={running}
        disabled={running}
      />

      {timings && (
        <View style={s.card}>
          <View style={s.row}>
            <Text style={[s.cell, s.head, s.wide]}>Puntos</Text>
            <Text style={[s.cell, s.head]}>Mediana</Text>
            <Text style={[s.cell, s.head]}>p95</Text>
          </View>
          {timings.map((t) => (
            <View key={t.points} style={s.row}>
              <Text style={[s.cell, s.wide]}>{t.points}</Text>
              <Text style={s.cell}>{t.medianMs.toFixed(2)} ms</Text>
              <Text style={[s.cell, t.p95Ms > RNF02_BUDGET_MS && { color: c.danger }]}>
                {t.p95Ms.toFixed(2)} ms
              </Text>
            </View>
          ))}
          <Text style={s.verdict}>
            {timings.every((t) => t.p95Ms < RNF02_BUDGET_MS)
              ? `Dentro del presupuesto de ${RNF02_BUDGET_MS} ms en todos los tamaños.`
              : `Supera el presupuesto de ${RNF02_BUDGET_MS} ms.`}
          </Text>
        </View>
      )}

      <Text style={[s.title, { marginTop: sp.xl }]}>RNF04. Consumo de batería</Text>
      <Text style={s.detail}>
        Techo de {RNF04_BUDGET_PER_HOUR} % por hora con la pantalla apagada. Iniciá la medición,
        bloqueá el teléfono y caminá. Al volver, detenela. Las lecturas hechas con el cargador
        enchufado se descartan del cálculo.
      </Text>

      {!batteryAvailable() ? (
        <Text style={s.detail}>Esta compilación no puede leer la batería.</Text>
      ) : (
        <>
          <View style={s.card}>
            <Text style={s.lectura}>
              {latest ? `${latest.level.toFixed(1)} %` : 'sin lectura'}
              {latest?.charging ? '  (cargando)' : ''}
            </Text>
            <Text style={s.detail}>
              {session ? 'Midiendo. Podés apagar la pantalla.' : 'Sin medición en curso.'}
            </Text>
          </View>

          <Button
            label={session ? 'Detener y calcular' : 'Iniciar medición'}
            onPress={() => void (session ? finish() : begin())}
            variant={session ? 'outline' : 'primary'}
          />
        </>
      )}

      {result && (
        <View style={s.card}>
          <Text style={s.verdict}>
            {result.perHour === null
              ? 'La medición fue demasiado corta para decir algo. Hacen falta al menos cinco minutos.'
              : `${result.perHour.toFixed(2)} % por hora, sobre ${Math.round(result.minutes)} minutos y ${result.samples.length} lecturas.`}
          </Text>
          {result.withinBudget !== null && (
            <Text
              style={[
                s.verdict,
                { color: result.withinBudget ? c.success : c.danger, fontWeight: '700' },
              ]}
            >
              {result.withinBudget
                ? `Dentro del techo de ${RNF04_BUDGET_PER_HOUR} % por hora.`
                : `Supera el techo de ${RNF04_BUDGET_PER_HOUR} % por hora.`}
            </Text>
          )}
          {result.droppedCharging > 0 && (
            <Text style={s.detail}>
              Se descartaron {result.droppedCharging} lecturas tomadas con el cargador.
            </Text>
          )}
        </View>
      )}
    </ScrollView>
  );
}

const styles = (c: Palette) =>
  StyleSheet.create({
    content: { padding: sp.lg, paddingBottom: sp.xl * 2, gap: sp.sm },
    title: { color: c.text, fontSize: 17, fontWeight: '800' },
    detail: { color: c.mutedText, fontSize: 13, lineHeight: 19 },
    card: {
      backgroundColor: c.surface,
      borderColor: c.border,
      borderWidth: 1.5,
      borderRadius: 14,
      padding: sp.lg,
      gap: sp.sm,
      marginVertical: sp.sm,
    },
    row: { flexDirection: 'row', alignItems: 'center' },
    cell: { color: c.text, fontSize: 13, flex: 1, textAlign: 'right' },
    wide: { flex: 1.2, textAlign: 'left' },
    head: { color: c.mutedText, fontWeight: '700', fontSize: 12 },
    lectura: { color: c.text, fontSize: 28, fontWeight: '800' },
    verdict: { color: c.text, fontSize: 13, lineHeight: 19 },
  });
