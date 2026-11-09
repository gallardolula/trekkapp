/** Offline map regions.
 *
 *  A region is a named area whose tiles the hiker downloads before
 *  leaving. Named rather than an arbitrary rectangle, which is what bounds
 *  how much a phone has to hold. See docs/adr/0006.
 *
 *  MapLibre keeps the downloaded tiles in its own store, so this module
 *  does not persist them. What it owns is the catalogue of what exists,
 *  which comes from the server, and the download itself.
 */
import { requestAuthenticated } from './api';
import { resolveBaseUrl } from './api';
import { maplibre } from '../ui/TrackMap';
import type { Point } from '../domain/types';

export interface Region {
  id: string;
  name: string;
  description: string;
  bounds: { west: number; south: number; east: number; north: number };
  minZoom: number;
  maxZoom: number;
  available: boolean;
  sizeBytes: number;
  tileCount: number;
  version: string;
}

export interface RegionProgress {
  /** Percentage completed, as MapLibre reports it. */
  percentage: number;
  completedTiles: number;
  requiredResources: number;
}

/** The status object the native module passes to the progress listener. */
interface NativePackStatus {
  percentage?: number;
  completedTileCount?: number;
  requiredResourceCount?: number;
}

/**
 * How many tiles one phone may hold across every region it downloads.
 *
 * A region of the Sierras is about five thousand basemap tiles and nearly
 * as many of contours, so the default of six thousand is below the cost of
 * a single one. Fifty thousand leaves room for several regions and still
 * bounds what the application can fill the phone with.
 */
const TILE_LIMIT = 50_000;

/** The style the region's tiles are drawn with, served by the same server. */
export function styleUrlFor(regionId: string): string {
  return `${resolveBaseUrl()}/api/regions/${regionId}/style.json`;
}

export async function listRegions(): Promise<Region[]> {
  const response = await requestAuthenticated<{ regions: Region[] }>('/api/regions');
  return response.regions;
}

/**
 * The offline manager, or null in Expo Go where the native module is absent.
 *
 * Reached through the same runtime require as the map itself, so that the
 * rest of the application keeps working without a development build.
 */
function manager(): {
  createPack: Function;
  getPacks: () => Promise<NativePack[]>;
  deletePack: (id: string) => Promise<void>;
  setTileCountLimit: (limit: number) => void;
} | null {
  const ml = maplibre as unknown as { OfflineManager?: Record<string, Function> } | null;
  return (ml?.OfflineManager as never) ?? null;
}

/**
 * A downloaded pack as MapLibre reports it.
 *
 * The identifier is assigned by the native module and the name given to
 * `createPack` is discarded, so the region a pack belongs to has to
 * travel in the metadata and be read back from there. Matching on the
 * name instead leaves every pack unrecognised, and a region that was
 * downloaded correctly looks like one that was never downloaded at all.
 */
interface NativePack {
  id: string;
  metadata?: { regionId?: string; version?: string };
}

async function packFor(regionId: string): Promise<NativePack | null> {
  const offline = manager();
  if (!offline) return null;
  const packs = await offline.getPacks();
  return packs.find((p) => p.metadata?.regionId === regionId) ?? null;
}

export const regionsSupported = () => manager() !== null;

/**
 * Downloads a region's tiles.
 *
 * MapLibre takes the bounds as four plain numbers in the order west,
 * south, east, north. Passing the two corner pairs that older versions of
 * the API accepted fails inside the native module, where the message is
 * harder to trace back than it looks.
 *
 * Reporting progress matters more here than almost anywhere else in the
 * application, because this is a long download the hiker has to finish
 * before leaving and cannot retry in the field.
 */
export async function downloadRegion(
  region: Region,
  onProgress: (p: RegionProgress) => void,
): Promise<void> {
  const offline = manager();
  if (!offline) throw new Error('el mapa sin conexión necesita la aplicación compilada');

  // MapLibre refuses to store more than six thousand tiles by default, a
  // guard meant for commercial tile services with terms about it. This
  // server is ours and the tiles come from OpenStreetMap, and one region
  // with its contours is already more than that, so the ceiling is raised
  // to something that bounds the phone's storage rather than a licence.
  offline.setTileCountLimit(TILE_LIMIT);

  // A pack already there would make createPack fail, and re-downloading a
  // region the hiker already has is exactly what should not happen.
  await removeRegion(region.id).catch(() => undefined);

  await new Promise<void>((resolve, reject) => {
    offline.createPack(
      {
        name: region.id,
        mapStyle: styleUrlFor(region.id),
        bounds: [
          region.bounds.west,
          region.bounds.south,
          region.bounds.east,
          region.bounds.north,
        ],
        minZoom: region.minZoom,
        maxZoom: region.maxZoom,
        metadata: { regionId: region.id, version: region.version, name: region.name },
      },
      (_pack: unknown, status: NativePackStatus) => {
        onProgress({
          percentage: status.percentage ?? 0,
          completedTiles: status.completedTileCount ?? 0,
          requiredResources: status.requiredResourceCount ?? 0,
        });
        if ((status.percentage ?? 0) >= 100) resolve();
      },
      // The native downloader fails for reasons that have nothing to do
      // with the network: a tile ceiling, a resource the style asked for
      // that the server refused, a full disk. Reporting all of them as a
      // connection problem sent somebody to check their signal while the
      // actual message, which named the cause, was thrown away.
      (_pack: unknown, error: unknown) => reject(new DownloadFailed(error)),
    );
  });
}

/** A failed region download, carrying whatever the native layer said. */
export class DownloadFailed extends Error {
  constructor(readonly cause: unknown) {
    const detail =
      cause instanceof Error
        ? cause.message
        : typeof cause === 'string'
          ? cause
          : typeof (cause as { message?: unknown })?.message === 'string'
            ? ((cause as { message: string }).message)
            : null;
    super(detail ?? 'la descarga no pudo completarse');
    this.name = 'DownloadFailed';
  }
}

/** What the phone holds, with the version of the archive it was built from. */
export interface DownloadedRegion {
  regionId: string;
  version: string;
}

export async function downloadedRegions(): Promise<DownloadedRegion[]> {
  const offline = manager();
  if (!offline) return [];
  const packs = await offline.getPacks();
  return packs
    .filter((p) => typeof p.metadata?.regionId === 'string')
    .map((p) => ({ regionId: p.metadata!.regionId!, version: p.metadata?.version ?? '' }));
}

export async function downloadedRegionIds(): Promise<string[]> {
  return (await downloadedRegions()).map((r) => r.regionId);
}

/**
 * Whether what the phone holds still matches what the server offers.
 *
 * Regenerating an archive changes its version, and a phone holding the
 * previous one would otherwise look up to date while covering a
 * different area or older data. Saying so is the point: the hiker cannot
 * discover it in the field.
 */
export function isStale(region: Region, held: DownloadedRegion[]): boolean {
  const pack = held.find((h) => h.regionId === region.id);
  return pack !== undefined && pack.version !== region.version;
}

export async function removeRegion(regionId: string): Promise<void> {
  const offline = manager();
  const pack = await packFor(regionId);
  if (!offline || !pack) return;
  await offline.deletePack(pack.id);
}

/** Which map a screen can draw, and whether it survives losing signal. */
export interface MapSource {
  styleUrl: string;
  /** True when the tiles are on the phone, false when they come over the air. */
  offline: boolean;
}

/** Whether a point falls inside a region's box. */
function covers(region: Region, p: Point): boolean {
  return (
    p.lat >= region.bounds.south &&
    p.lat <= region.bounds.north &&
    p.lon >= region.bounds.west &&
    p.lon <= region.bounds.east
  );
}

/**
 * The best map available for a place, right now.
 *
 * A downloaded region first, because it works regardless of signal and
 * costs nothing to read. Failing that, the same style over the network:
 * the tiles live on the server and are a request away, and withholding
 * them until somebody downloads forty six megabytes meant the application
 * showed a schematic line to a hiker sitting at home on wi-fi.
 *
 * Which of the two it is matters and is returned, because somebody has to
 * be told plainly that the map they are looking at will not be there on
 * the mountain.
 */
export async function resolveMapSource(at: Point | null): Promise<MapSource | null> {
  const held = await downloadedRegions();
  if (held.length > 0) {
    // With several packs, the one covering this place if it can be told,
    // and otherwise the first: the phone holds it either way.
    const match = at
      ? await (async () => {
          try {
            const known = await listRegions();
            const inside = known.find((r) => covers(r, at));
            return inside && held.some((h) => h.regionId === inside.id) ? inside.id : null;
          } catch {
            return null;
          }
        })()
      : null;
    return { styleUrl: styleUrlFor(match ?? held[0]!.regionId), offline: true };
  }

  // Nothing downloaded. The catalogue needs the server, so reaching it is
  // itself the test of whether the map can be drawn at all.
  try {
    const known = await listRegions();
    const usable = known.filter((r) => r.available);
    const inside = at ? usable.find((r) => covers(r, at)) : undefined;
    const chosen = inside ?? usable[0];
    return chosen ? { styleUrl: styleUrlFor(chosen.id), offline: false } : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------- one trail at a time --

/**
 * Brings the map of a single trail onto the phone.
 *
 * A region of the Sierras is forty six megabytes and covers a hundred by a
 * hundred and fifty kilometres, almost none of which anybody walks. The
 * corridor around one trail is a couple of megabytes, and it is what
 * somebody leaving the house tomorrow morning actually needs.
 *
 * The region download stays, for whoever wants the whole area or walks
 * several trails in it. This is the ordinary case rather than the only one.
 *
 * MapLibre stores a pack's resources in one shared database and counts the
 * references, so the style, the glyphs and any tile two trails have in
 * common are held once however many trails are downloaded.
 */
export async function downloadTrail(
  trail: { id: string; name: string },
  track: Point[],
  region: Region,
  onProgress: (p: RegionProgress) => void,
): Promise<void> {
  const offline = manager();
  if (!offline) throw new Error('el mapa sin conexión necesita la aplicación compilada');
  if (track.length < 2) throw new Error('este sendero todavía no tiene traza');

  offline.setTileCountLimit(TILE_LIMIT);
  await removeTrail(trail.id).catch(() => undefined);

  const bounds = corridor(track);

  await new Promise<void>((resolve, reject) => {
    offline.createPack(
      {
        name: trail.id,
        mapStyle: styleUrlFor(region.id),
        bounds,
        // From eleven, which is where the contours begin and where the
        // surroundings still mean something, up to whatever the archive
        // holds. Starting lower would pull in tiles covering provinces.
        minZoom: Math.max(region.minZoom, 11),
        maxZoom: region.maxZoom,
        metadata: { trailId: trail.id, name: trail.name, version: region.version },
      },
      (_pack: unknown, status: NativePackStatus) => {
        onProgress({
          percentage: status.percentage ?? 0,
          completedTiles: status.completedTileCount ?? 0,
          requiredResources: status.requiredResourceCount ?? 0,
        });
        if ((status.percentage ?? 0) >= 100) resolve();
      },
      (_pack: unknown, error: unknown) => reject(new DownloadFailed(error)),
    );
  });
}

/**
 * The box around a trail, widened so the walk has surroundings.
 *
 * A box drawn tight to the track gives a map that ends at the edge of the
 * path, which is useless the moment somebody looks up to work out where
 * they are. The margin is in degrees and deliberately crude: it is a
 * kilometre and a bit, and the cost of being generous here is a handful of
 * tiles.
 */
function corridor(track: Point[]): [number, number, number, number] {
  const margin = 0.012;
  const lats = track.map((p) => p.lat);
  const lons = track.map((p) => p.lon);
  return [
    Math.min(...lons) - margin,
    Math.min(...lats) - margin,
    Math.max(...lons) + margin,
    Math.max(...lats) + margin,
  ];
}

/** Which trails have their map on the phone. */
export async function downloadedTrailIds(): Promise<string[]> {
  const offline = manager();
  if (!offline) return [];
  const packs = await offline.getPacks();
  return packs
    .map((p) => (p.metadata as { trailId?: string } | undefined)?.trailId)
    .filter((id): id is string => typeof id === 'string');
}

export async function removeTrail(trailId: string): Promise<void> {
  const offline = manager();
  if (!offline) return;
  const packs = await offline.getPacks();
  const pack = packs.find((p) => (p.metadata as { trailId?: string } | undefined)?.trailId === trailId);
  if (pack) await offline.deletePack(pack.id);
}

/** The region a trail falls in, which is where its tiles come from. */
export async function regionFor(at: Point): Promise<Region | null> {
  try {
    const known = await listRegions();
    return known.find((r) => r.available && covers(r, at)) ?? null;
  } catch {
    return null;
  }
}
