/** The two requirements that can only be answered on a device.
 *
 *  RNF02 puts a budget on evaluating a position against the track and RNF04
 *  on what an hour of navigation costs in battery. Both were stated and
 *  neither was measured, which is the easiest kind of claim to make and the
 *  hardest to defend.
 *
 *  The first runs here and finishes in seconds. The second cannot: it needs
 *  the phone carried with the screen off for long enough that the reading
 *  means something, so a session survives the screen being locked and gives
 *  the rate when it is stopped.
 *
 *  Expo Go carries no battery module, so where there is nothing to ask the
 *  level is typed from the indicator the phone already shows. Two
 *  percentages and the time between them is the whole measurement, and the
 *  arithmetic does not care where the numbers came from.
 *
 *  Figures and nothing else. This is an instrument, and an instrument that
 *  explains itself on screen is a manual rather than a dial.
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
import { report, RNF02_BUDGET_MS, type Timing } from '../src/domain/benchmark';
import { Button, Field } from '../src/ui/forms';
import { Palette, sp, useTheme } from '../src/ui/theme';

/** How often a reading is taken while this screen is awake. */
const SAMPLE_EVERY_MS = 60_000;

export default function Measurements() {
  const { c } = useTheme();
  const s = useMemo(() => styles(c), [c]);

  const [timings, setTimings] = useState<Timing[] | null>(null);
  const [running, setRunning] = useState(false);

  const automatic = batteryAvailable();
  const [session, setSession] = useState<string | null>(null);
  const [latest, setLatest] = useState<Sample | null>(null);
  const [result, setResult] = useState<SessionResult | null>(null);
  const [typed, setTyped] = useState('');

  useEffect(() => {
    if (automatic) void readBattery().then(setLatest);
  }, [automatic]);

  // While this screen is awake it keeps sampling, where there is a module to
  // ask. A locked phone stops the timer and costs resolution, not the
  // measurement: the rate comes from the first and last readings, and one is
  // written when the session stops.
  useEffect(() => {
    if (!session || !automatic) return;
    const timer = setInterval(() => {
      void sample(session).then((r) => r && setLatest(r));
    }, SAMPLE_EVERY_MS);
    return () => clearInterval(timer);
  }, [session, automatic]);

  const measureSpeed = useCallback(() => {
    setRunning(true);
    // Yielded to the next frame so the button paints its busy state before
    // the thread is taken for the length of the benchmark.
    setTimeout(() => {
      setTimings(report());
      setRunning(false);
    }, 50);
  }, []);

  const level = () => (automatic ? undefined : Number(typed.replace(',', '.')));
  const usable = automatic || (typed.length > 0 && Number.isFinite(Number(typed.replace(',', '.'))));

  async function begin() {
    setResult(null);
    const started = await startSession(level());
    setSession(started);
    setTyped('');
    if (started && automatic) setLatest(await readBattery());
  }

  async function finish() {
    if (!session) return;
    await sample(session, level());
    setResult(await resultOf(session));
    setSession(null);
    setTyped('');
  }

  return (
    <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
      <Text style={s.title}>RNF02. Evaluación de la posición</Text>

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
        </View>
      )}

      <Text style={[s.title, { marginTop: sp.xl }]}>RNF04. Consumo de batería</Text>

      {automatic ? (
        <View style={s.card}>
          <Text style={s.lectura}>
            {latest ? `${latest.level.toFixed(1)} %` : '—'}
            {latest?.charging ? '  ⚡' : ''}
          </Text>
        </View>
      ) : (
        <Field
          label="Batería"
          value={typed}
          onChangeText={(v) => setTyped(v.replace(/[^0-9.,]/g, '').slice(0, 5))}
          keyboardType="decimal-pad"
          placeholder="%"
        />
      )}

      <Button
        label={session ? 'Detener' : 'Medir'}
        onPress={() => void (session ? finish() : begin())}
        variant={session ? 'outline' : 'primary'}
        disabled={!usable}
      />

      {result && (
        <View style={s.card}>
          <Text style={s.lectura}>
            {result.perHour === null ? '—' : `${result.perHour.toFixed(2)} %/h`}
          </Text>
          <View style={s.row}>
            <Text style={[s.cell, s.head, s.wide]}>{Math.round(result.minutes)} min</Text>
            <Text style={[s.cell, s.head]}>{result.samples.length} lecturas</Text>
            <Text
              style={[
                s.cell,
                s.head,
                result.withinBudget !== null && {
                  color: result.withinBudget ? c.success : c.danger,
                },
              ]}
            >
              de {RNF04_BUDGET_PER_HOUR} %/h
            </Text>
          </View>
        </View>
      )}
    </ScrollView>
  );
}

const styles = (c: Palette) =>
  StyleSheet.create({
    content: { padding: sp.lg, paddingBottom: sp.xl * 2, gap: sp.sm },
    title: { color: c.text, fontSize: 17, fontWeight: '800' },
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
  });
