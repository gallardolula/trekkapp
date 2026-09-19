# 5. User-generated content is append-only

- **Status**: Accepted
- **Date**: 2026-09-19

## Context

Hikers produce trail-condition reports while offline, potentially for hours,
possibly on more than one device. Under [ADR-0001](./0001-offline-first-local-store.md)
those writes land locally first and reconcile later. Bidirectional
reconciliation of mutable records is the hard part of any offline-first design:
last-write-wins loses data, vector clocks and CRDTs carry real complexity, and
manual merge UIs ask the user to resolve a problem they did not create.

## Decision

Reports and contributed trails are append-only. They are created, never edited
or deleted by the author. Each carries a UUID generated on the device, which the
server treats as an idempotency key. A correction is a new report, not a
modification of an earlier one.

The catalogue is server-authoritative — the device never edits published trails.
The profile is the single mutable bidirectional record, reconciled by
last-write-wins on its `actualizado_en` timestamp.

## Consequences

**Positive**

- Conflicts between offline writes cannot arise, so no resolution strategy is
  needed for the content users actually produce.
- Uploads are idempotent: a retry after an interrupted sync cannot duplicate a
  report.
- The history of a trail's condition is preserved, which is more useful than a
  current-value field.

**Negative**

- A hiker cannot correct a typo in a submitted report; they add another.
- Report volume grows monotonically, so display must order by recency and
  probably age out old entries visually.

**Neutral**

- Moderation still applies to contributed trails; append-only governs conflict
  semantics, not publication.

## Alternatives considered

| Alternative | Rejected because |
| --- | --- |
| Mutable records with last-write-wins | Silent data loss when two devices report different observations. |
| CRDTs | Complexity far beyond what the content model needs. |
| Manual conflict resolution in the UI | Asks the hiker to resolve a problem the design created. |
