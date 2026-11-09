/** The hours ahead on the trail, read sideways.
 *
 *  A day's minimum and maximum say whether to go. The hours say when to
 *  leave and when to be off the ridge, which on a mountain is the decision
 *  somebody actually makes: six hundred metres of ascent is a different
 *  outing at nine in the morning than at four in the afternoon with a
 *  storm building.
 *
 *  Three figures per hour and no more. Temperature, the chance of rain and
 *  the wind are what change a plan; humidity and pressure do not, and a
 *  strip somebody reads while walking has room for what matters.
 *
 *  The wind carries a threshold rather than only a number, because forty
 *  kilometres an hour on a summit ridge is not the same fact as forty in a
 *  valley and the figure alone does not say so.
 */
import { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { CloudRain, Droplets, Thermometer, Wind } from 'lucide-react-native';

import { HourlyForecast } from '../domain/types';
import { Palette, sp, useTheme } from './theme';

/** Above this the wind is worth marking, not merely reporting. */
const STRONG_WIND_KMH = 40;

/** Above this the rain is likely rather than possible. */
const LIKELY_RAIN = 50;

export interface WeatherStripProps {
  hours: HourlyForecast[];
  /** Shown under the strip, because a forecast read as fresh is a lie. */
  obtainedAt?: string | null;
}

export function WeatherStrip({ hours, obtainedAt }: WeatherStripProps) {
  const { c } = useTheme();
  const s = useMemo(() => styles(c), [c]);

  if (hours.length === 0) return null;

  return (
    <View>
      <View style={s.head}>
        <Thermometer size={15} color={c.mutedText} strokeWidth={2} />
        <Text style={s.title}>Las próximas horas en el sendero</Text>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={s.strip}
        style={s.stripOuter}
      >
        {hours.map((h) => {
          const windy = h.windKmh >= STRONG_WIND_KMH;
          const wet = h.rainChance >= LIKELY_RAIN;
          return (
            <View key={h.time} style={[s.hour, (windy || wet) && { borderColor: c.warning }]}>
              <Text style={s.when}>{hourOf(h.time)}</Text>

              <Text style={s.temp}>{Math.round(h.tempC)}°</Text>

              <View style={s.row}>
                {wet ? (
                  <CloudRain size={13} color={c.warning} strokeWidth={2.2} />
                ) : (
                  <Droplets size={13} color={c.mutedText} strokeWidth={2.2} />
                )}
                <Text style={[s.figure, wet && { color: c.warning, fontWeight: '700' }]}>
                  {Math.round(h.rainChance)}%
                </Text>
              </View>

              <View style={s.row}>
                <Wind size={13} color={windy ? c.warning : c.mutedText} strokeWidth={2.2} />
                <Text style={[s.figure, windy && { color: c.warning, fontWeight: '700' }]}>
                  {Math.round(h.windKmh)}
                </Text>
              </View>
            </View>
          );
        })}
      </ScrollView>

      <Text style={s.foot}>
        Viento en km/h y probabilidad de lluvia. Se marcan las horas con más de{' '}
        {STRONG_WIND_KMH} km/h o más de {LIKELY_RAIN}% de lluvia.
        {obtainedAt ? ` Pronóstico de ${age(obtainedAt)}.` : ''}
      </Text>
    </View>
  );
}

/** The hour, local to the trail, which is how the provider returns it. */
function hourOf(iso: string): string {
  const at = new Date(iso);
  return `${String(at.getHours()).padStart(2, '0')}h`;
}

function age(iso: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `hace ${hours} h` : `hace ${Math.round(hours / 24)} d`;
}

const styles = (c: Palette) =>
  StyleSheet.create({
    head: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: sp.sm },
    title: { color: c.text, fontWeight: '700', fontSize: 13 },
    stripOuter: { marginHorizontal: -sp.lg },
    strip: { gap: sp.sm, paddingHorizontal: sp.lg, paddingVertical: 2 },
    hour: {
      alignItems: 'center',
      gap: 4,
      minWidth: 62,
      backgroundColor: c.surface,
      borderColor: c.border,
      borderWidth: 1.5,
      borderRadius: 14,
      paddingVertical: sp.md,
      paddingHorizontal: sp.sm,
    },
    when: { color: c.mutedText, fontSize: 11.5, fontWeight: '600' },
    temp: { color: c.text, fontSize: 19, fontWeight: '800' },
    row: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    figure: { color: c.mutedText, fontSize: 11.5 },
    foot: { color: c.mutedText, fontSize: 11, lineHeight: 16, marginTop: sp.sm },
  });
