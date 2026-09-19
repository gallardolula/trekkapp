# 4. Explicit, user-initiated synchronisation

- **Status**: Accepted
- **Date**: 2026-09-19

## Context

The device holds reports and contributed trails that must eventually reach the
server, and a catalogue that must eventually be refreshed. The usual answer is
background synchronisation on connectivity change.

In this context the phone is safety equipment that cannot be recharged for the
duration of a hike. Background network activity is unpredictable battery cost,
and connectivity on a trail is intermittent, so a connectivity-triggered sync can
fire repeatedly at the worst possible moment: partial coverage at altitude, with
the radio burning power to hold a marginal signal.

## Decision

Synchronisation runs only when the hiker asks for it, or at session start. There
is no background sync daemon and no connectivity-change trigger. The pending
queue is visible, and the result of a sync is reported explicitly.

## Consequences

**Positive**

- Battery cost is predictable and chosen by the person paying it.
- No network activity during a hike, which is when the budget is tightest.
- Sync failures are visible instead of silently retried.

**Negative**

- Data reaches the server later than it could; a hiker who never syncs keeps
  their reports local.
- The pending state must be surfaced in the UI, which would otherwise be
  invisible.

**Neutral**

- The queue must survive process death, which it would in either design.

## Alternatives considered

| Alternative | Rejected because |
| --- | --- |
| Background sync on connectivity change | Unpredictable battery cost; repeated retries under marginal coverage. |
| Periodic background task | Same cost, plus platform scheduling that cannot be relied on when the app is suspended. |
| Sync on app foreground only | Closer, but still implicit; the hiker cannot decline it. |
