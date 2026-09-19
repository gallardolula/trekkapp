# 3. Trail attributes computed on write, never supplied

- **Status**: Accepted
- **Date**: 2026-09-19

## Context

Total distance, cumulative ascent, effort index and difficulty class determine
whether a hiker is warned before downloading a trail. Trails can be contributed
by users, so those values could arrive from an untrusted source. A trail
labelled easier than its geometry warrants would defeat the gating rule at the
exact moment it matters.

## Decision

The persistence layer computes every derived attribute from the stored geometry
during the write. Callers may not supply them; the write API does not accept
them. The server recomputes on ingest for the same reason.

## Consequences

**Positive**

- Difficulty cannot be misdeclared, by mistake or on purpose.
- Attributes and geometry cannot drift apart.
- The classification thresholds have one definition, in the domain layer.

**Negative**

- Writing a trail costs a full pass over its points. Acceptable: writes are rare,
  reads during a hike are not.
- Changing the classification thresholds requires recomputing stored trails.

**Neutral**

- Metadata the geometry cannot yield — name, description — is still supplied by
  the contributor and remains subject to moderation.

## Alternatives considered

| Alternative | Rejected because |
| --- | --- |
| Trust the values in the GPX or the contribution | The safety rule would depend on untrusted input. |
| Compute on read | Repeated cost on every listing, and no stable value to sort or filter by. |
| Validate supplied values against a recomputation | Same cost as computing, plus a discrepancy path to handle. |
