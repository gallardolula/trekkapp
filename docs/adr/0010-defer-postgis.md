# 10. Defer PostGIS until a proximity query exists

- **Status**: Accepted
- **Date**: 2026-11-08

## Context

The server data model was specified with the trail geometry held as a
PostGIS `LINESTRING` behind a GiST index, so that proximity queries would be
indexed rather than scanned.

When the backend was built, no requirement asked for such a query. The
functional requirements cover listing the catalogue, downloading a trail,
comparing a position against a downloaded track and reporting the condition
of a path. The one calculation that is genuinely spatial, the distance from
the hiker to the track, runs on the device during the walk, where there is
no server to ask.

Installing the extension carries a cost that is small but not zero. It has
to exist on the deployment target as well as on the development machine, it
constrains which managed providers are usable, and it has to be present
before the first migration runs or that migration fails.

## Decision

Store the geometry as ordered rows in `track_points`, mirroring the device
schema, and leave PostGIS out.

Introduce the extension, with a migration that adds the geometry column and
backfills it from the existing rows, when the first requirement that needs
an indexed spatial query appears. A likely candidate is "trails near me",
which is not currently in scope.

## Consequences

**Positive**

- The schema the server holds is the schema the device holds, which keeps
  the synchronisation code free of a translation step.
- Any PostgreSQL provider can host the database, including free plans that
  do not offer the extension.
- One fewer dependency that has to match between development and deployment.

**Negative**

- A proximity query written today would scan the points table. With a
  catalogue of the size this prototype handles that is acceptable, and with
  a larger one it would not be.
- Backfilling a geometry column later is extra work that building it now
  would avoid.

**Neutral**

- Postgres.app ships PostGIS, so the extension is available locally the day
  it is needed and no reinstallation is required.

## Alternatives considered

| Alternative | Rejected because |
| --- | --- |
| Install PostGIS now and leave the column unused | Pays the constraint on providers and migrations for a capability nothing calls. |
| Compute proximity in the application over all trails | Correct for the current catalogue size, but it is the thing PostGIS exists to avoid, and adding it later is cheaper than writing and then removing this. |
| Store the track as a JSON array on the trail row | Rejected on the device for the same reason it is rejected here: the sequence is walked whole and a blob forces a full parse. |
