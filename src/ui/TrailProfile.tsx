/** The elevation profile of a trail, drawn.
 *
 *  Height against distance walked, which is the one picture that separates
 *  two trails the catalogue card describes identically. A steady morning's
 *  climb and six flat kilometres followed by a wall have the same length
 *  and the same total ascent.
 *
 *  Needs nothing from the network. The heights travelled with the track and
 *  are already on the device, which is the point: a trail is legible the
 *  moment the application is installed, with no map downloaded and no
 *  connection at all.
 */
import { useMemo } from 'react';
import { View } from 'react-native';
import Svg, { Defs, LinearGradient, Line, Path, Polyline, Stop, Text as SvgText } from 'react-native-svg';

import { type TrailProfile as Profile } from '../domain/profile';
import { Palette } from './theme';

export interface TrailProfileProps {
  profile: Profile;
  colours: Palette;
  width: number;
  height?: number;
}

export function TrailProfile({ profile, colours, width, height = 150 }: TrailProfileProps) {
  const view = useMemo(() => {
    const padLeft = 38;
    const padRight = 10;
    const padTop = 12;
    const padBottom = 22;

    const plotW = width - padLeft - padRight;
    const plotH = height - padTop - padBottom;

    // The vertical range is padded so a trail that climbs little is not
    // drawn as a mountain. Exaggerating a gentle walk is the easiest way
    // for a chart like this to lie.
    const span = Math.max(profile.maxM - profile.minM, 50);
    const floor = profile.minM - (span - (profile.maxM - profile.minM)) / 2;

    const x = (d: number) => padLeft + (d / Math.max(profile.lengthM, 1)) * plotW;
    const y = (e: number) => padTop + plotH - ((e - floor) / span) * plotH;

    const points = profile.samples.map((p) => `${x(p.distanceM).toFixed(1)},${y(p.elevationM).toFixed(1)}`);

    return {
      line: points.join(' '),
      area: `M${x(0).toFixed(1)},${(padTop + plotH).toFixed(1)} L${points.join(' L')} L${x(
        profile.lengthM,
      ).toFixed(1)},${(padTop + plotH).toFixed(1)} Z`,
      baseline: padTop + plotH,
      padLeft,
      plotW,
      yTop: y(profile.maxM),
      yBottom: y(profile.minM),
      hard: profile.steepest &&
        profile.steepest.grade > 0.12 && {
          from: x(profile.steepest.fromM),
          to: x(profile.steepest.toM),
          // The band is marked with its own gradient rather than with a
          // sentence underneath. A figure on the stretch it describes is
          // read where it applies; a line of prose under the drawing is
          // read after the drawing, or not at all.
          grade: `${Math.round(profile.steepest.grade * 100)} %`,
        },
    };
  }, [profile, width, height]);

  return (
    <View>
      <Svg width={width} height={height}>
        <Defs>
          <LinearGradient id="profile-fill" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={colours.primary} stopOpacity={0.28} />
            <Stop offset="1" stopColor={colours.primary} stopOpacity={0.04} />
          </LinearGradient>
        </Defs>

        {/* The hardest stretch, marked under the line rather than on it, so
            it reads as ground covered and not as a different trail. */}
        {view.hard && (
          <>
            <Path
              d={`M${view.hard.from},0 L${view.hard.to},0 L${view.hard.to},${view.baseline} L${view.hard.from},${view.baseline} Z`}
              fill={colours.warning}
              fillOpacity={0.12}
            />
            <SvgText
              x={(view.hard.from + view.hard.to) / 2}
              y={11}
              fontSize={10}
              fontWeight="700"
              fill={colours.warning}
              textAnchor="middle"
            >
              {view.hard.grade}
            </SvgText>
          </>
        )}

        <Line
          x1={view.padLeft}
          y1={view.baseline}
          x2={view.padLeft + view.plotW}
          y2={view.baseline}
          stroke={colours.border}
          strokeWidth={1}
        />

        <Path d={view.area} fill="url(#profile-fill)" />
        <Polyline
          points={view.line}
          fill="none"
          stroke={colours.primary}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        <SvgText x={4} y={view.yTop + 4} fontSize={10} fill={colours.mutedText}>
          {`${Math.round(profile.maxM)} m`}
        </SvgText>
        <SvgText x={4} y={view.yBottom + 4} fontSize={10} fill={colours.mutedText}>
          {`${Math.round(profile.minM)} m`}
        </SvgText>
        <SvgText x={view.padLeft} y={height - 6} fontSize={10} fill={colours.mutedText}>
          0 km
        </SvgText>
        <SvgText
          x={view.padLeft + view.plotW}
          y={height - 6}
          fontSize={10}
          fill={colours.mutedText}
          textAnchor="end"
        >
          {`${(profile.lengthM / 1000).toFixed(1)} km`}
        </SvgText>
      </Svg>
    </View>
  );
}
