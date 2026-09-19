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
