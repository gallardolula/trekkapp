# 9. Hysteresis in the deviation alert

- **Status**: Accepted
- **Date**: 2026-09-19

## Context

The deviation alert compares distance-to-track against a tolerance radius of
50 m. A direct comparison produces two failure modes, both observed in practice
with consumer GNSS receivers:

- **False positives.** Error in a gorge or under canopy routinely exceeds 50 m on
  a single fix, while the hiker is on the trail.
- **Oscillation.** Walking along the boundary makes the alert open and close
  repeatedly, which trains the user to ignore it.

An alert that cries wolf is worse than no alert, because it destroys trust in
the one signal that matters.

## Decision

Two thresholds and two counters:

- Opening requires **three consecutive fixes** beyond the radius.
- Closing requires **three consecutive fixes** within **70 %** of the radius —
  35 m — not merely back inside it.
- The alert is raised once on opening and not repeated while it remains open.

The evaluation is a pure function taking the previous state and returning the
next, so the behaviour is fully reproducible in tests.

## Consequences

**Positive**

- Single-fix error no longer produces an alert.
- The alert cannot oscillate on the boundary; re-entry must be unambiguous.
- Eight unit tests pin the behaviour, including the oscillation case.

**Negative**

- Detection is delayed by up to two sampling intervals — roughly 20–30 s at the
  planned rate. Acceptable against the cost of a false alert.
- A genuine brief excursion that self-corrects within three fixes is not
  reported.

**Neutral**

- The parameters are domain constants and can be tuned, including per user, once
  field data exists.

## Alternatives considered

| Alternative | Rejected because |
| --- | --- |
| Single-fix threshold | False alerts under normal GNSS error; destroys trust. |
| Filtering position with a Kalman filter | Heavier, harder to explain and to test, and solves a different problem. |
| Accuracy-weighted radius | Worth revisiting; needs field data on reported accuracy before it can be tuned honestly. |

## Follow-up

Confirm the parameters against real traces during field testing.
