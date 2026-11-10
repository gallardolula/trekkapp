/** The map during a hike.
 *
 *  Draws the downloaded track, the hiker's position and the reports left on
 *  the path, over a vector basemap served from tiles already on the device.
 *  It fills whatever it is given, which on the hike screen is the whole
 *  screen: a map the size of a postcard shows a line with no surroundings,
 *  and the surroundings are the part that tells somebody where they are.
 *
 *  MapLibre is a native module and is absent from Expo Go, so the import
 *  is attempted at runtime rather than declared. When it is missing the
 *  component falls back to the schematic rendering, which shows the same
 *  geometry without a basemap. That keeps every other part of the
 *  application testable in Expo Go instead of forcing a development build
 *  on anyone who only wants to look at the catalogue.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import Svg, { Circle, Line, Polyline, Rect } from 'react-native-svg';

import { Point } from '../domain/types';
import { Palette } from './theme';

/** The camera handle, narrowed to the movements this screen makes. */
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
  easeTo: (options: { center: [number, number]; zoom?: number; duration?: number }) => void;
}

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

/** A report drawn on the path, where it was left. */
export interface MapReport {
  id: string;
  lat: number;
  lon: number;
  /** Drives the colour, so a blocked path reads differently from a notice. */
  severity: 'blocking' | 'hazard' | 'notice';
}

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
  /** Changing this brings the camera back to the hiker. */
  centreToken?: number;
  /** Reports already left on this path. */
  reports?: MapReport[];
  /** While true a tap anywhere reports where it landed. */
  picking?: boolean;
  onPick?: (p: Point) => void;
  /** The point being marked, drawn so it can be confirmed before saving. */
  pick?: Point | null;
  /**
   * Whether the hiker can pan and zoom it.
   *
   * Version 11 names the gestures one by one rather than offering a single
   * switch, and knows nothing of the scrollEnabled and zoomEnabled of
   * other map libraries, which it would accept and quietly ignore.
   *
   * Off for the preview on a trail's page. A map the size of a postcard
   * that moves under the thumb swallows the scroll of the page it sits in
   * and shows no more of the trail than it did before, so there it is a
   * picture that opens the real one.
   */
  interactive?: boolean;
  /**
   * What to keep clear of the trail when framing it, in pixels.
   *
   * The full screen map reserves the bottom for the panel over it. A
   * preview reserves a margin and nothing more.
   */
  fitPadding?: { top: number; right: number; bottom: number; left: number };
}

/** Enough to keep the trail off the edges, and no more. */
const PREVIEW_PADDING = { top: 24, right: 24, bottom: 24, left: 24 };

const SEVERITY_COLOUR = {
  blocking: '#c1352b',
  hazard: '#d08400',
  notice: '#3a7bd0',
} as const;

/** Enclosing box of a track, in the order MapLibre expects. */
function boundsOf(track: Point[]): [number, number, number, number] | null {
  // Two points at least. A box with no width and no height makes the
  // camera zoom to its maximum on a single coordinate.
  if (track.length < 2) return null;
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
  centreToken = 0,
  reports = [],
  picking = false,
  onPick,
  pick = null,
  interactive = true,
  fitPadding = PREVIEW_PADDING,
  maplibre: ml,
}: TrackMapProps & { maplibre: MapLibreModule }) {
  const { Map, Camera, GeoJSONSource, Layer } = ml;
  const camera = useRef<CameraRef | null>(null);

  // GeoJSON orders a coordinate as longitude then latitude, the reverse of
  // how the domain names them. Getting this round the wrong way draws the
  // trail in the Indian Ocean, so the conversion lives in one place.
  // Null below two points, and the source is then left out altogether. A
  // line of one point, or of none, is geometry the renderer refuses: it
  // logs "invalid geometry in line layer" once per worker, names neither
  // the layer nor the feature, and draws the rest of the map as if nothing
  // had happened. A trail whose geometry has not arrived yet is exactly
  // that case, and it is an ordinary one.
  const line = useMemo(
    () =>
      track.length >= 2
        ? {
            type: 'Feature' as const,
            geometry: {
              type: 'LineString' as const,
              coordinates: track.map((p) => [p.lon, p.lat]),
            },
            properties: {},
          }
        : null,
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

  // One source for every report, with the colour carried as a property, so
  // a path with thirty reports still costs one layer rather than thirty.
  const pins = useMemo(
    () => ({
      type: 'FeatureCollection' as const,
      features: reports.map((r) => ({
        type: 'Feature' as const,
        id: r.id,
        geometry: { type: 'Point' as const, coordinates: [r.lon, r.lat] },
        properties: { colour: SEVERITY_COLOUR[r.severity] },
      })),
    }),
    [reports],
  );

  const marked = useMemo(
    () =>
      pick
        ? {
            type: 'Feature' as const,
            geometry: { type: 'Point' as const, coordinates: [pick.lon, pick.lat] },
            properties: {},
          }
        : null,
    [pick],
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
  //
  // The padding is what is kept clear of the trail, in pixels of this map,
  // so it cannot be one fixed set of numbers. The full screen one reserves
  // the bottom for the panel sitting over it; a preview two hundred pixels
  // tall given that same reservation has nothing left to draw in and backs
  // the camera off until the trail is a speck.
  useEffect(() => {
    if (!bounds || !mapReady) return;
    camera.current?.fitBounds(bounds, { padding: fitPadding, duration: 500 });
  }, [bounds, fitToken, mapReady, fitPadding]);

  // Brings the camera back to the hiker, on request and while walking.
  useEffect(() => {
    if (!position || !mapReady) return;
    if (!follow && centreToken === 0) return;
    camera.current?.easeTo({
      center: [position.lon, position.lat],
      ...(follow ? {} : { zoom: 15.5 }),
      duration: 600,
    });
  }, [follow, position, centreToken, mapReady]);

  /**
   * The tap, in the shape the rest of the application speaks.
   *
   * MapLibre reports it as `nativeEvent.lngLat`, a pair ordered longitude
   * first, which is the reverse of how the domain names a point. Reading it
   * the other way round puts the marker in the Indian Ocean rather than
   * failing, so the conversion is made once, here.
   */
  function handlePress(event: unknown) {
    if (!picking || !onPick) return;
    const lngLat = (event as { nativeEvent?: { lngLat?: [number, number] } })?.nativeEvent?.lngLat;
    if (!lngLat || lngLat.length !== 2) return;
    onPick({ lon: lngLat[0], lat: lngLat[1] });
  }

  return (
    <View style={{ width, height }}>
      {/* Version 11 renamed the ornaments: `logo` and `attribution` rather
          than the `…Enabled` pair of older releases, which the native view
          simply ignored. Attribution stays on, because the basemap is built
          from OpenStreetMap and its licence requires the credit. The compass
          earns its place on a trail. */}
      <Map
        style={{ flex: 1 }}
        mapStyle={styleUrl}
        logo={false}
        attribution
        attributionPosition={{ bottom: 8, left: 8 }}
        compass={interactive}
        compassPosition={{ top: 72, right: 16 }}
        dragPan={interactive}
        touchZoom={interactive}
        doubleTapZoom={interactive}
        doubleTapHoldZoom={interactive}
        touchRotate={interactive}
        touchPitch={interactive}
        onDidFinishLoadingMap={() => setMapReady(true)}
        onPress={handlePress}
      >
        <Camera ref={camera} />

        {line && (
          <GeoJSONSource id="track" data={line}>
          <Layer
            id="track-casing"
            type="line"
            source="track"
            layout={{ 'line-join': 'round', 'line-cap': 'round' }}
            paint={{ 'line-color': '#ffffff', 'line-width': 9, 'line-opacity': 0.8 }}
          />
          <Layer
            id="track-line"
            type="line"
            source="track"
            layout={{ 'line-join': 'round', 'line-cap': 'round' }}
            paint={{ 'line-color': colours.danger, 'line-width': 5 }}
          />
          </GeoJSONSource>
        )}

        <GeoJSONSource id="reports" data={pins}>
          <Layer
            id="report-halo"
            type="circle"
            source="reports"
            paint={{ 'circle-radius': 11, 'circle-color': '#ffffff' }}
          />
          <Layer
            id="report-dot"
            type="circle"
            source="reports"
            paint={{ 'circle-radius': 7, 'circle-color': ['get', 'colour'] }}
          />
        </GeoJSONSource>

        {marked && (
          <GeoJSONSource id="pick" data={marked}>
            <Layer
              id="pick-halo"
              type="circle"
              source="pick"
              paint={{ 'circle-radius': 18, 'circle-color': colours.primary, 'circle-opacity': 0.25 }}
            />
            <Layer
              id="pick-dot"
              type="circle"
              source="pick"
              paint={{
                'circle-radius': 8,
                'circle-color': colours.primary,
                'circle-stroke-width': 3,
                'circle-stroke-color': '#ffffff',
              }}
            />
          </GeoJSONSource>
        )}

        {me && (
          <GeoJSONSource id="position" data={me}>
            <Layer
              id="position-halo"
              type="circle"
              source="position"
              paint={{ 'circle-radius': 16, 'circle-color': colour, 'circle-opacity': 0.22 }}
            />
            <Layer
              id="position-dot"
              type="circle"
              source="position"
              paint={{
                'circle-radius': 7,
                'circle-color': colour,
                'circle-stroke-width': 3,
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
  reports = [],
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
    const pad = 24;
    const spanLat = maxLat - minLat || 1e-6;
    const spanLon = maxLon - minLon || 1e-6;

    const project = (p: { lat: number; lon: number }) => ({
      x: pad + ((p.lon - minLon) / spanLon) * (width - 2 * pad),
      y: height - pad - ((p.lat - minLat) / spanLat) * (height - 2 * pad),
    });

    return {
      line: track.map(project).map((q) => `${q.x.toFixed(1)},${q.y.toFixed(1)}`).join(' '),
      me: position ? project(position) : null,
      pins: reports.map((r) => ({ ...project(r), severity: r.severity, id: r.id })),
    };
  }, [track, position, width, height, reports]);

  return (
    <View style={{ width, height }}>
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
            strokeWidth={3}
            strokeLinejoin="round"
          />
        )}
        {view?.pins.map((p) => (
          <Circle
            key={p.id}
            cx={p.x}
            cy={p.y}
            r={6}
            fill={SEVERITY_COLOUR[p.severity]}
            stroke="#ffffff"
            strokeWidth={2}
          />
        ))}
        {view?.me && (
          <>
            <Circle
              cx={view.me.x}
              cy={view.me.y}
              r={15}
              fill={offTrack ? colours.danger : colours.primary}
              opacity={0.22}
            />
            <Circle
              cx={view.me.x}
              cy={view.me.y}
              r={7}
              fill={offTrack ? colours.danger : colours.primary}
              stroke="#ffffff"
              strokeWidth={2}
            />
          </>
        )}
      </Svg>
    </View>
  );
}
