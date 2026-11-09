# 6. Self-generated tiles from an OpenStreetMap extract

- **Status**: Accepted
- **Date**: 2026-09-19

## Context

Offline navigation requires the basemap to be on the device before the hike,
which means downloading a region's tiles in bulk. OpenStreetMap is the natural
data source, but the public tile servers at `tile.openstreetmap.org` are run on
donated infrastructure and their usage policy explicitly forbids bulk
downloading. Commercial tile providers permit offline caching under terms that
vary by plan and can change.

## Decision

The project generates its own vector tiles: a Geofabrik extract for Córdoba,
processed with Planetiler at build time into a tile archive, stored in object
storage and served behind the API. The app downloads named regions — Sierras
Grandes, Champaquí — rather than arbitrary bounding boxes. The map style ships
inside the app bundle.

## Consequences

**Positive**

- No dependency on a third party's offline-caching terms, and no risk of a plan
  change breaking the core feature.
- No per-tile cost and no API key on the device.
- The covered area is bounded deliberately, which also bounds region size.

**Negative**

- A build step to own: extract, generate, upload, version.
- Map data is only as fresh as the last generation; refresh is manual per
  release.
- Coverage is limited to the regions generated. A hiker outside them has no map.

**Neutral**

- ODbL attribution must be rendered on the map and in the about screen. This is
  a licence condition, not a courtesy.

## Alternatives considered

| Alternative | Rejected because |
| --- | --- |
| Public OSM tile servers | Usage policy forbids bulk download, which is what offline requires. |
| Commercial provider (MapTiler, Stadia and similar) | Offline permissions depend on plan terms that can change; introduces cost and an API key. |
| Raster tiles instead of vector | Larger archives for the same coverage, no style changes without regeneration. |

## Follow-up

Region granularity and archive size are unresolved. A spike generates one
region and measures before the map sprint.

---

## Outcome, 2026-11-09

Built, with three differences from what this record anticipated.

The archive is served from the server's own disk rather than object storage,
which remains the right choice for a deployment and is not yet needed for a
prototype running on one machine.

The style is served by the server rather than shipped in the application
bundle, so that the tile and glyph addresses match the server actually
answering, which differs between a phone on the local network and a
deployment. It is built in `server/src/tiles/style.ts`.

The glyphs are served too. A vector map carries no letters, and MapLibre draws
no text at all when the style does not say where to fetch them, without
reporting anything. The offline downloader requests every one of the two
hundred and fifty six ranges of each font stack, so ranges the server does not
hold answer with an empty glyph stack rather than a refusal; a single failed
resource fails an entire region download.

The region version folds in a style revision, because a downloaded pack holds
whatever the style asked for. A style that starts drawing labels leaves every
pack already on a phone incomplete without one tile having changed.

Contour lines are served as a second source from a separate archive. See
[0012](./0012-contours-from-a-separate-elevation-source.md).
