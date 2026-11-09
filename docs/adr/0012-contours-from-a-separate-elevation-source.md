# 12. Contour lines from a separate elevation source

- **Status**: Accepted
- **Date**: 2026-11-09

## Context

The basemap generated under [0006](./0006-self-generated-map-tiles.md) follows
the OpenMapTiles schema, which carries no elevation of any kind. For a map
somebody reads on a mountain that is the missing half: a trail drawn across
blank ground says nothing about whether the next kilometre is a stroll or a
climb, and the shape of the terrain around it is what tells a hiker where they
are when the markings run out.

## Decision

Contours are generated from a second data source and served as a second vector
source beside the basemap, at `/api/regions/:id/contours/{z}/{x}/{y}.pbf`,
from an archive of its own.

The heights come from the terrain tiles of the AWS Open Data registry, which
need no account and derive from SRTM and NASADEM. A height grid is traced with
marching squares at twenty-five metre intervals, the segments are stitched into
long lines, and the result is written as vector tiles. Every fourth line is
marked as an index line, drawn heavier and carrying its height.

The two archives stay separate. They come from different data under different
terms, are produced by different tools, and change on entirely different
timescales: the basemap follows OpenStreetMap edits and the terrain does not
change at all.

## Consequences

**Positive**

- The map shows the shape of the ground, which is what makes it a mountain map
  rather than a diagram with a line on it.
- The same elevation data gives heights to the generated catalogue
  ([0013](./0013-catalogue-generated-from-openstreetmap.md)), which
  OpenStreetMap does not carry.
- Regenerating contours does not mean regenerating the basemap.

**Negative**

- The region roughly doubles, from twenty-one megabytes to forty-six, and
  contours are the larger half.
- Another build step to own, and another archive to version.
- The resolution of the source is about twenty metres at this latitude, so a
  twenty-five metre contour is near the limit of what the data supports. On
  gentle ground the lines wander.

**Neutral**

- The style declares the contour source only when the archive exists, because
  a source nobody can answer leaves the map requesting tiles that are not
  there on every pan.

## Alternatives considered

| Alternative | Rejected because |
| --- | --- |
| Hillshading from raster terrain tiles | Much larger offline, and it shows the shape without giving a height anybody can read. |
| A contour layer inside the basemap archive | Couples two datasets with different licences and refresh cycles into one build. |
| A hosted terrain service | Needs a connection, which is the one thing the map cannot assume. |

## Follow-up

The interval is fixed at twenty-five metres for the whole region. Flat country
near Córdoba would read better at a larger interval than the Sierras Grandes,
which the generator cannot currently express.
