# 1. Offline-first with SQLite as the primary store

- **Status**: Accepted
- **Date**: 2026-09-19

## Context

The application is used on mountain trails where cellular coverage is absent or
intermittent. The failure is not incidental: it happens precisely on the stretch
where a navigation error carries the highest consequence, and it happens without
warning.

A conventional client-server design treats the network as normally available and
the local store as a cache — an optimisation over an authority that can be
reached. On a trail that authority cannot be reached at all, for hours.

## Decision

The device holds the primary store: a SQLite database embedded in the
application. Every feature needed during a hike reads and writes locally and
never awaits a network response. The server holds a replica that the device
reconciles with later.

## Consequences

**Positive**

- The hike path has no network dependency, so it cannot fail for network reasons.
- Behaviour is identical with the radio off, which is also the battery-optimal
  configuration in the field.
- Reads are local, so the map and position views stay responsive.

**Negative**

- Reconciliation becomes an explicit, designed subsystem rather than a side
  effect of requests. See [ADR-0004](./0004-explicit-user-initiated-sync.md) and
  [ADR-0005](./0005-append-only-user-content.md).
- The catalogue on the device can be stale; staleness has to be surfaced rather
  than hidden.
- Storage on the device is finite, which bounds how many regions and trails can
  be held at once.

**Neutral**

- The schema must be migrated in place across app updates; downloaded trails
  cannot be discarded on upgrade.

## Alternatives considered

| Alternative | Rejected because |
| --- | --- |
| Server-first with a read-through cache | Implies an authority reachable on demand. On the trail there is none. |
| Cache-then-network per screen | Pushes connectivity handling into every screen; inconsistent behaviour and no single source of truth. |
| Full replication of the entire catalogue | Unbounded storage for a user who walks three trails a year. |
