# Architecture Decision Records

Each file records one decision: the context that forced it, what was decided,
and what it costs. Records are immutable — a decision that changes is not
edited, it is superseded by a new record and marked here.

Format: [Michael Nygard's](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions)
template, with an explicit *Alternatives considered* section.

| # | Decision | Status | Affects |
| --- | --- | --- | --- |
| [0001](./0001-offline-first-local-store.md) | Offline-first with SQLite as the primary store | Accepted | Whole system |
| [0002](./0002-framework-free-domain-layer.md) | Domain layer free of framework imports | Accepted | Mobile app |
| [0003](./0003-derived-attributes-computed-on-write.md) | Trail attributes computed on write, never supplied | Accepted | Data model |
| [0004](./0004-explicit-user-initiated-sync.md) | Explicit, user-initiated synchronisation | Accepted | Sync, battery |
| [0005](./0005-append-only-user-content.md) | User-generated content is append-only | Accepted | Sync, data model |
| [0006](./0006-self-generated-map-tiles.md) | Self-generated tiles from an OpenStreetMap extract | Accepted | Cartography |
| [0007](./0007-forecast-through-backend.md) | Forecast retrieved through the backend | Accepted | Integrations |
| [0008](./0008-maplibre-for-map-rendering.md) | MapLibre Native for map rendering | Accepted | Mobile app |
| [0009](./0009-deviation-alert-hysteresis.md) | Hysteresis in the deviation alert | Accepted | Rules engine |

## Writing a new record

1. Next free number, filename `NNNN-short-kebab-title.md`.
2. Status starts as `Proposed`; becomes `Accepted` when the code follows it.
3. State the forces, not just the conclusion. A record that only says what was
   chosen is not useful six months later.
4. Record the cost honestly in *Consequences*. A decision with no downside was
   not a decision.
5. Add the row to the table above.

Open questions not yet decided are tracked in
[architecture.md § Open decisions](../architecture.md#14-open-decisions) and
become records when they are resolved.
