/** The illustration at the head of a trail card.
 *
 *  The applications this layout is modelled on lead with a photograph.
 *  TrekkApp has none, and could not get one without connectivity, so rather
 *  than stock imagery each card draws the trail itself: the shape of the
 *  track seen from above, over the profile of the ground it climbs.
 *
 *  That is not a decoration standing in for a picture. Two trails of the
 *  same length read very differently here, one as a straight line along a
 *  ridge and the other as a switchback, and the profile underneath says at a
 *  glance whether the climb is one long haul or spread over the day.
 */
import { useMemo } from 'react';
import Svg, { Defs, LinearGradient, Path, Polyline, Rect, Stop } from 'react-native-svg';

import { Point } from '../domain/types';
import { Palette } from './theme';

export interface TrailArtProps {
  track: Point[];
  colours: Palette;
  width: number;
  height: number;
  /** Drawn over a filled card, so the art has to carry its own background. */
  tint: string;
}

/** Fits the track into the box, keeping its proportions. */
function project(track: Point[], width: number, height: number, pad: number) {
  if (track.length < 2) return null;

  const lats = track.map((p) => p.lat);
  const lons = track.map((p) => p.lon);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);

  // Longitude degrees are shorter than latitude degrees away from the
  // equator. Ignoring that stretches the drawing sideways and a trail that
  // runs north to south comes out looking like one that runs east to west.
  const midLat = ((minLat + maxLat) / 2) * (Math.PI / 180);
  const spanX = Math.max((maxLon - minLon) * Math.cos(midLat), 1e-9);
  const spanY = Math.max(maxLat - minLat, 1e-9);

  const usableW = width - pad * 2;
  const usableH = height - pad * 2;
  const scale = Math.min(usableW / spanX, usableH / spanY);
  const offsetX = (usableW - spanX * scale) / 2;
  const offsetY = (usableH - spanY * scale) / 2;

  return track
    .map((p) => {
      const x = pad + offsetX + (p.lon - minLon) * Math.cos(midLat) * scale;
      const y = pad + offsetY + (maxLat - p.lat) * scale;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

/** The ground profile, as a closed shape sitting on the bottom edge. */
function elevationArea(track: Point[], width: number, height: number): string | null {
  const elevations = track.map((p) => p.ele).filter((e): e is number => typeof e === 'number');
  if (elevations.length < 2) return null;

  const min = Math.min(...elevations);
  const max = Math.max(...elevations);
  const span = Math.max(max - min, 1);
  const band = height * 0.32;

  const points = elevations.map((e, i) => {
    const x = (i / (elevations.length - 1)) * width;
    const y = height - ((e - min) / span) * band;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  return `M0,${height} L${points.join(' L')} L${width},${height} Z`;
}

export function TrailArt({ track, colours, width, height, tint }: TrailArtProps) {
  const line = useMemo(() => project(track, width, height * 0.78, 18), [track, width, height]);
  const ground = useMemo(() => elevationArea(track, width, height), [track, width, height]);

  // Several of these are on screen at once and a gradient is referenced by
  // identifier, so a fixed one would have every card drawn with whichever
  // definition rendered last. Derived from the colour rather than a counter
  // so it stays the same across re-renders, and two cards that do share it
  // share an identical definition.
  const gradientId = `trail-art-${tint.replace(/[^a-z0-9]/gi, '')}`;

  return (
    <Svg width={width} height={height}>
      <Defs>
        <LinearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={tint} stopOpacity={0.95} />
          <Stop offset="1" stopColor={tint} stopOpacity={0.55} />
        </LinearGradient>
      </Defs>

      <Rect x={0} y={0} width={width} height={height} fill={`url(#${gradientId})`} />

      {ground && <Path d={ground} fill={colours.onPrimary} fillOpacity={0.14} />}

      {line && (
        <>
          {/* Drawn twice, the wider pass underneath, so the trace stays
              legible wherever it crosses the lighter part of the ground. */}
          <Polyline
            points={line}
            fill="none"
            stroke={colours.onPrimary}
            strokeOpacity={0.35}
            strokeWidth={7}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Polyline
            points={line}
            fill="none"
            stroke={colours.onPrimary}
            strokeWidth={3}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      )}
    </Svg>
  );
}
