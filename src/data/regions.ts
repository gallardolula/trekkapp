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
      (_pack: unknown, error: unknown) => reject(error),
    );
  });
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
