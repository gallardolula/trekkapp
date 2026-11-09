# 14. Photographs stay on the device that took them

- **Status**: Accepted
- **Date**: 2026-11-09

## Context

A walk produces photographs and every comparable application shows them. The
obvious design is the one those applications use: hikers upload, everybody
sees, and the pictures become the most persuasive thing in the catalogue.

Those applications also moderate. The trust-and-safety teams, the automated
image classification and the report-and-takedown flows are invisible, which
makes the feature look free. It is not.

Record [0011](./0011-system-validated-contributions.md) removed the moderator
on the grounds that a machine can check everything that matters about a trail.
That argument does not transfer. A trail is geometry: whether it is in the
area, walkable, continuous and not a duplicate is entirely in the numbers. A
photograph is content. No simple code can tell whether it shows the path,
shows somebody who did not agree to be in it, is a copyrighted image taken
from elsewhere, or is something nobody should be shown. Those are the actual
risks and none of them are legible in the pixels.

## Decision

Photographs are taken during a walk, stored in the application's own directory
on the phone, and recorded in `hike_photos` against the hike they belong to.
They are not uploaded, not attached to a report, and not visible to anybody
else.

This is the design and not a first stage of one. A photograph nobody else sees
needs no moderation, because there is no audience to protect.

## Consequences

**Positive**

- The most useful part of photographs for the person who took them, which is
  looking back at their own outing, is delivered with no moderation, no
  storage cost and no third party.
- Nothing the application holds about other people can be harmful, because it
  holds nothing about other people.
- It keeps the system honest: no feature here depends on a safety process that
  does not exist.

**Negative**

- The catalogue stays without imagery, which is the single biggest visual
  difference from comparable applications.
- A photograph of a washed-out ford is probably the most useful condition
  report there is, and it cannot be sent.
- Photographs are lost with the phone. There is no backup and no transfer to a
  new device, unlike the account, the trails and the reports.

**Neutral**

- Taking a photograph requires a development build carrying
  `expo-image-picker`. Writing one, listing one and deleting its file need no
  camera and work in any build, so a build without it loses the button and
  nothing else.

## Alternatives considered

| Alternative | Rejected because |
| --- | --- |
| Shared photographs with a report-and-hide loop | The flags arrive after the first viewer has already seen it, which for a public application is the risk that matters. |
| Automated image moderation through a service | Per-image cost, an account and a key, and the photographs of users sent to a third party. Defensible, but not for a prototype. |
| Photographs on reports only, shared | Same exposure as the above with a narrower benefit. |

## Follow-up

If photographs are ever shared, this record is superseded rather than amended,
and the replacement has to say who moderates and how.
