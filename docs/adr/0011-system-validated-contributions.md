# 11. Contributed trails are validated by the system, not reviewed by a person

- **Status**: Accepted
- **Date**: 2026-11-09

## Context

The design carried a moderator: a trail contributed by a hiker entered a
review queue and waited for somebody holding that role to publish or reject
it. Two things were wrong with it.

The role could not exist. Registration always wrote `hiker`, nothing promoted
an account, and so the queue could never be worked by anybody. A contribution
entered `pending_review` and stayed there for good. The endpoints that would
have served the queue were unreachable, and the rule that decided who could
retrieve an unpublished trail named the moderator rather than the owner, so
the one person who could not retrieve their own contribution was whoever made
it.

The deeper problem is that the review promised a verification it could not
perform. What a reviewer sees is a line on a screen. Whether that line crosses
private land, whether the area is closed for the season — which in the Sierras
de Córdoba happens every year over fire risk — and whether it holds a ford
that is lethal in flood are not visible there and are not in the geometry
either. A reviewer would have approved on the same information the system has.

## Decision

The moderator is removed, as a role and as a profile. There is one kind of
account. A contribution is checked by `server/src/trails/validation.ts` and
published or refused, with a named reason and the point in the track where the
problem was found.

The checks establish that the track is inside the area this project serves,
long enough and short enough to be one outing, continuous, climbing at a rate
somebody walks, recorded at walking pace, that it travels rather than circling
one spot, and that it is not a second recording of a trail already published.

What the checks cannot establish is written into the module rather than left
implicit, and a published contribution is labelled as automatically validated
and not verified on the ground.

## Consequences

**Positive**

- A contribution is answered immediately instead of waiting on nobody.
- A refusal names what to fix, so the contribution can be corrected rather
  than lost.
- The system stops implying a human verification that never happened.
- Duplicate recordings of the same route no longer accumulate, which was a
  real failure mode: twenty copies of the Quebrada del Condorito, none of them
  distinguishable to somebody choosing one.

**Negative**

- Nothing stands between a well-formed but ill-advised trail and the
  catalogue. The geometry can be perfect and the route still cross a field
  somebody farms.
- The checks are thresholds, so they reject some legitimate contributions and
  admit some dull ones.

**Neutral**

- The `withdrawn` state exists for a trail taken out of the catalogue. Nothing
  writes it yet; the rule that would, driven by condition reports, is not
  built. Until it is, there is no correction after the fact, which is the half
  of this that remains missing.

## Alternatives considered

| Alternative | Rejected because |
| --- | --- |
| Keep the moderator and build the screens | Nobody can hold the role, and the review cannot establish what matters. Building the queue would have made the promise more visible, not more true. |
| Moderation as an operational task outside the product | Defensible, but it adds a piece nobody in a prototype would ever use, and the honesty problem is unchanged. |
| Publish with no checks at all | The catalogue fills with fragments, car-park loops and duplicates within a week. |

## Follow-up

Withdrawing a trail when enough people report it impassable is the missing
control. It needs decisions this record does not make: how many reports, from
how many people, of which kinds, and how a trail comes back once it is walkable
again.
