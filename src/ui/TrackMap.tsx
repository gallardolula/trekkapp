/** The map during a hike.
 *
 *  Draws the downloaded track and the hiker's position over a vector
 *  basemap served from tiles already on the device.
 *
 *  MapLibre is a native module and is absent from Expo Go, so the import
 *  is attempted at runtime rather than declared. When it is missing the
 *  component falls back to the schematic rendering, which shows the same
 *  geometry without a basemap. That keeps every other part of the
 *  application testable in Expo Go instead of forcing a development build
 *  on anyone who only wants to look at the catalogue.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Line, Polyline, Rect } from 'react-native-svg';

import { Point } from '../domain/types';
import { Palette, sp } from './theme';

/**
 * The pieces of MapLibre this screen uses.
 *
 * Version 11 renamed them: the map is `Map` rather than `MapView`, a
 * GeoJSON feature is served by `GeoJSONSource` rather than `ShapeSource`,
 * and every layer is a single `Layer` discriminated by its `type` instead
 * of one component per kind. Layer appearance is given as `paint` and
 * `layout` using the style specification's own property names, which is
 * what the server's style document already uses.
 */
/** The camera handle, narrowed to the two movements this screen makes. */
interface CameraRef {
  fitBounds: (
    bounds: [number, number, number, number],
    // Padding is given per side and not as one number. A number reaches
    // the native layer and fails there, where the message names a type
    // cast rather than the call that caused it.
    options?: {
      padding?: { top?: number; right?: number; bottom?: number; left?: number };
      duration?: number;
    },
  ) => void;
  easeTo: (options: { center: [number, number]; duration?: number }) => void;
}

interface MapLibreModule {
  Map: React.ComponentType<Record<string, unknown>>;
  Camera: React.ComponentType<Record<string, unknown>>;
  GeoJSONSource: React.ComponentType<Record<string, unknown>>;
  Layer: React.ComponentType<Record<string, unknown>>;
}

/**
 * Resolved once, at module load.
 *
 * `require` inside a try is the only way to ask whether a native module is
 * present without the bundler failing the import outright.
 */
export const maplibre: MapLibreModule | null = (() => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const m = require('@maplibre/maplibre-react-native') as Partial<MapLibreModule>;
    // Presence of the package is not enough. A rename between versions
    // leaves the import succeeding and the components undefined, which
    // surfaces as a render error deep inside React rather than here.
    if (!m.Map || !m.Camera || !m.GeoJSONSource || !m.Layer) return null;
    return m as MapLibreModule;
  } catch {
    return null;
  }
})();

export const mapAvailable = maplibre !== null;

export interface TrackMapProps {
  track: Point[];
  position: Point | null;
  offTrack: boolean;
  /** Address of the style the region was downloaded with. */
  styleUrl: string | null;
  colours: Palette;
  width: number;
  height: number;
  /**
   * While true the camera eases to each new position.
   *
   * Off before the walk starts, so the whole route can be looked over,
   * and on while navigating, which is the one moment staying centred on
   * the hiker is what they want.
   */
  follow?: boolean;
  /** Changing this frames the entire route, start to finish. */
  fitToken?: number;
}

/** Enclosing box of a track, in the order MapLibre expects. */
function boundsOf(track: Point[]): [number, number, number, number] | null {
  if (track.length === 0) return null;
  const lats = track.map((p) => p.lat);
  const lons = track.map((p) => p.lon);
  return [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)];
}

export function TrackMap(props: TrackMapProps) {
  if (!maplibre || !props.styleUrl) return <SchematicTrack {...props} />;
  return <VectorTrack {...props} maplibre={maplibre} />;
}

function VectorTrack({
  track,
  position,
  offTrack,
  styleUrl,
  colours,
  width,
  height,
  follow = false,
  fitToken = 0,
  maplibre: ml,
}: TrackMapProps & { maplibre: MapLibreModule }) {
  const { Map, Camera, GeoJSONSource, Layer } = ml;
  const camera = useRef<CameraRef | null>(null);

  // GeoJSON orders a coordinate as longitude then latitude, the reverse of
  // how the domain names them. Getting this round the wrong way draws the
  // trail in the Indian Ocean, so the conversion lives in one place.
  const line = useMemo(
    () => ({
      type: 'Feature' as const,
      geometry: { type: 'LineString' as const, coordinates: track.map((p) => [p.lon, p.lat]) },
      properties: {},
    }),
    [track],
  );

  const me = useMemo(
    () =>
      position
        ? {
            type: 'Feature' as const,
            geometry: { type: 'Point' as const, coordinates: [position.lon, position.lat] },
            properties: {},
          }
        : null,
    [position],
  );

  const colour = offTrack ? colours.danger : colours.primary;
  const bounds = useMemo(() => boundsOf(track), [track]);

  // A camera movement asked for before the native map has finished
  // loading is silently dropped, and the track arrives from the database
  // well before the map is ready. The first framing therefore waits for
  // the map to say it is loaded, which is also why opening a trail used
  // to show nothing until the hiker pressed the button by hand.
  const [mapReady, setMapReady] = useState(false);

  // Frames the whole route. Done imperatively rather than as a prop so the
  // hiker can pan away afterwards without the map pulling itself back.
  useEffect(() => {
    if (!bounds || !mapReady) return;
    camera.current?.fitBounds(bounds, {
      padding: { top: 40, right: 40, bottom: 40, left: 40 },
      duration: 500,
    });
  }, [bounds, fitToken, mapReady]);

  // Follows the walk, and only while it is under way.
  useEffect(() => {
    if (!follow || !position || !mapReady) return;
    camera.current?.easeTo({ center: [position.lon, position.lat], duration: 600 });
  }, [follow, position, mapReady]);

  return (
    <View style={{ width, height, borderRadius: 12, overflow: 'hidden' }}>
      <Map
        style={{ flex: 1 }}
        mapStyle={styleUrl}
        logoEnabled={false}
        attributionEnabled
        onDidFinishLoadingMap={() => setMapReady(true)}
      >
        <Camera ref={camera} />

        <GeoJSONSource id="track" data={line}>
          <Layer
            id="track-line"
            type="line"
            source="track"
            layout={{ 'line-join': 'round', 'line-cap': 'round' }}
            paint={{ 'line-color': colours.danger, 'line-width': 4 }}
          />
        </GeoJSONSource>

        {me && (
          <GeoJSONSource id="position" data={me}>
            <Layer
              id="position-halo"
              type="circle"
              source="position"
              paint={{ 'circle-radius': 14, 'circle-color': colour, 'circle-opacity': 0.22 }}
            />
            <Layer
              id="position-dot"
              type="circle"
              source="position"
              paint={{
                'circle-radius': 6,
                'circle-color': colour,
                'circle-stroke-width': 2,
                'circle-stroke-color': '#ffffff',
              }}
            />
          </GeoJSONSource>
        )}
      </Map>
    </View>
  );
}

/**
 * Schematic rendering, used when there is no basemap.
 *
 * The track is projected linearly onto the canvas. It carries no
 * cartography and says so, because a drawing that looks like a map but is
 * not one is worse than an obvious diagram.
 */
export function SchematicTrack({
  track,
  position,
  offTrack,
  colours,
  width,
  height,
}: TrackMapProps) {
  const view = useMemo(() => {
    const pts = position ? [...track, position] : track;
    if (pts.length === 0) return null;

    const lats = pts.map((p) => p.lat);
    const lons = pts.map((p) => p.lon);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLon = Math.min(...lons);
    const maxLon = Math.max(...lons);
    const pad = 18;
    const spanLat = maxLat - minLat || 1e-6;
    const spanLon = maxLon - minLon || 1e-6;

    const project = (p: Point) => ({
      x: pad + ((p.lon - minLon) / spanLon) * (width - 2 * pad),
      y: height - pad - ((p.lat - minLat) / spanLat) * (height - 2 * pad),
    });

    return {
      line: track.map(project).map((q) => `${q.x.toFixed(1)},${q.y.toFixed(1)}`).join(' '),
      me: position ? project(position) : null,
    };
  }, [track, position, width, height]);

  const s = styles(colours);

  return (
    <View>
      <Svg width={width} height={height}>
        <Rect x={0} y={0} width={width} height={height} fill={colours.canvas} />
        {[1, 2, 3].map((i) => (
          <Line
            key={`h${i}`}
            x1={0}
            y1={(height / 4) * i}
            x2={width}
            y2={(height / 4) * i}
            stroke={colours.canvasLine}
            strokeWidth={1}
          />
        ))}
        {view && (
          <Polyline
            points={view.line}
            fill="none"
            stroke={colours.danger}
            strokeWidth={2.5}
            strokeLinejoin="round"
          />
        )}
        {view?.me && (
          <>
            <Circle
              cx={view.me.x}
              cy={view.me.y}
              r={13}
              fill={offTrack ? colours.danger : colours.primary}
              opacity={0.22}
            />
            <Circle
              cx={view.me.x}
              cy={view.me.y}
              r={6}
              fill={offTrack ? colours.danger : colours.primary}
            />
          </>
        )}
      </Svg>
      <Text style={s.note}>
        Esquema de la traza sin cartografía. Descargá la región del mapa para ver el terreno.
      </Text>
    </View>
  );
}

const styles = (c: Palette) =>
  StyleSheet.create({
    note: {
      color: c.mutedText,
      fontSize: 11,
      textAlign: 'center',
      marginTop: sp.xs,
      paddingHorizontal: sp.sm,
    },
  });
