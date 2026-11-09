# 2. Domain layer free of framework imports

- **Status**: Accepted
- **Date**: 2026-09-19

## Context

The rules that make this system more than a catalogue — difficulty
classification, level gating, deviation detection, weather thresholds — are the
part whose correctness matters most, and the part hardest to exercise in the
field. Testing them by walking a trail is slow and unrepeatable.

React Native code conventionally mixes computation into components, where it can
only be exercised through a rendered tree on a device or emulator.

## Decision

`src/dominio/` contains plain TypeScript with no imports outside itself: no
React, no Expo, no I/O, no clock access except through injected parameters. All
functions are pure. Persistence and presentation depend on the domain; the
domain depends on nothing.

## Consequences

**Positive**

- Tests run on Node in under a second, with no emulator and no native preset.
- The behaviour proven by the test suite is the behaviour that runs on the
  trail, because it is literally the same code with the same inputs.
- The rules are readable as a description of the business, useful directly for
  the dissertation.

**Negative**

- Some ceremony: state that a stateful implementation would keep internally is
  threaded through parameters and return values, as with the deviation state.
- The boundary is currently enforced by review only.

**Neutral**

- Domain functions cannot log or persist; callers decide what to record.

## Alternatives considered

| Alternative | Rejected because |
| --- | --- |
| Rules inside React components/hooks | Testable only through a rendered tree; slow and coupled to the UI. |
| Rules on the server | Unavailable exactly when needed. Contradicts [ADR-0001](./0001-offline-first-local-store.md). |
| A rules engine library | Disproportionate for four rules, and adds a dependency to the safety path. |

## Follow-up

An import-boundary lint rule is a candidate hardening step.

---

## Outcome, 2026-11-09

The folder is `src/domain/`. It was renamed when the code moved to English,
and the rule it carries is unchanged: plain TypeScript, no imports outside
itself, and the very same modules are imported by the server so that a client
and a server can never disagree about how demanding a trail is.
