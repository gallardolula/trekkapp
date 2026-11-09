# 13. The installed catalogue is generated from OpenStreetMap

- **Status**: Accepted
- **Date**: 2026-11-09

## Context

The application shipped with four trails written out by hand as waypoints.
That was enough to demonstrate the rules and was not a catalogue. Somebody
installing the application had nothing to look at until they signed in,
synchronised and downloaded a region, which for a product whose whole claim is
working without a connection is the wrong way round.

Filling it by hand does not scale past a demonstration, and waiting for
contributions means an empty catalogue on the day it is needed most.

## Decision

The preloaded catalogue is generated at build time from OpenStreetMap and
ships inside the application bundle. `server/src/trails/make-catalogue.ts`
queries Overpass for the named paths and hiking routes of a region, joins the
fragments each trail arrives in, discards what is not a walk, and gives every
point a height from the terrain data of
[0012](./0012-contours-from-a-separate-elevation-source.md).

The attributes are then computed by the same domain code the application runs,
so a trail that shipped with the install is measured exactly like one a hiker
imports from a file, which is the rule in
[0003](./0003-derived-attributes-computed-on-write.md).

Identifiers are derived from the source ways, so regenerating updates trails
instead of duplicating them, and seeding prunes what the catalogue no longer
ships.

## Consequences

**Positive**

- A hundred and two trails of the Sierras are present on first start, in
  aeroplane mode, with their geometry, profile and difficulty.
- The catalogue is reproducible: anybody can run the generator and get the
  same result from the same data.
- It is real data about real paths, rather than invented lines that would have
  to be presented as if they were surveyed.

**Negative**

- Quality varies with what contributors recorded. Names are sometimes partial,
  a path can be drawn to a precision nobody promised, and the filtering is
  heuristic, so something dull gets in and something good gets dropped.
- The catalogue is as fresh as the last generation. A path mapped tomorrow
  appears only in the next release.
- Just under a megabyte is added to the bundle.

**Neutral**

- The data is under the Open Database Licence, which requires attribution of
  anything derived from it. The catalogue screen carries it, and it doubles as
  the honest label: nobody on this project has walked these.

## Alternatives considered

| Alternative | Rejected because |
| --- | --- |
| Keep writing trails by hand | Does not reach a catalogue, and every entry is an assertion nobody verified. |
| Fetch the catalogue on first run | Returns the application to needing a connection before it is useful, which is what this fixes. |
| Extract from the Geofabrik file already downloaded for tiles | The extract is a whole country and parsing it needs a toolchain this project does not have. Overpass answers the same question in one request. |

## Follow-up

Hiking routes are modelled in OpenStreetMap as relations, and the Sierras
currently hold exactly one. Almost everything here is individually named ways,
which is why the joining carries so much of the weight.
