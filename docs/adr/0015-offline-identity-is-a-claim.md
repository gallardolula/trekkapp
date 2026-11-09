# 15. Offline, identity is a claim and not a proof

- **Status**: Accepted
- **Date**: 2026-11-09

## Context

The application is built to be used where there is no signal, and the account
lives on a server that cannot be reached from there. That leaves a question
the design had answered only by implication: who is the person holding the
phone, when nothing can be checked against anything?

It matters for three reasons. Reports are attributed to somebody. The walks in
the history are somebody's. And a phone is lent, sold and handed on.

## Decision

Identity on the device is a claim the application accepts, because nothing it
can do offline affects anybody else, and because it has no means to do
otherwise.

Operations fall into three tiers:

| Tier | Needs | Examples |
| --- | --- | --- |
| Local, no identity | Nothing | Browsing the preloaded catalogue, a trail's profile, walking it, recording the walk, writing reports into the queue, reading a stored forecast |
| Local, identity claimed | The profile row on the device | The history, the hiker's own reports, the declared level, photographs |
| Server-verified | A token the server accepts now | Creating an account, signing in, synchronising, contributing a trail, a fresh forecast, downloading a region |

A report written on a trail is **provisional**. It carries the local account
identifier and sits in the queue; it becomes attributed when it reaches the
server, which re-verifies the token at that moment. If the token is dead the
report stays queued and the hiker is asked to sign in again.

The first run requires connectivity. Creating an account or signing in cannot
be done offline, and the application says so on the welcome screen before the
attempt rather than failing afterwards with a message about the connection.

Local data is protected by the operating system and by nothing this
application adds: the database sits in private application storage, which no
other process can read, and is encrypted at rest on a device with a lock
screen. Tokens are in the Keychain or Keystore, which is stronger than the
database.

A device that changes hands is handled explicitly. Signing in with a different
account clears the queue, the cursors, the walks, the reports and the alert
log, after a confirmation, because an unsent report left behind would travel
up under the new account's name.

## Consequences

**Positive**

- Everything a hike needs runs with no session check, which is what makes the
  field behaviour identical to the behaviour under test.
- The one place identity is actually enforced, the server, enforces it on
  every request rather than trusting a device's word.
- The answer to "what can somebody do offline" is a table rather than an
  argument.

**Negative**

- Somebody who picks up an unlocked phone can see the owner's walks and write
  reports as them until those reports reach the server. The mitigation is the
  device lock screen, which is not this application's to enforce.
- The application is unusable on a first run without connectivity, which for
  an offline-first product is the one concession, and it is on the screen that
  needs a connection anyway to be useful at all.

**Neutral**

- No passphrase and no application-level encryption of the local database. A
  passphrase typed every time the application opens on a mountain is a safety
  hazard of its own, and a key stored beside the data it protects protects
  nothing.

## Alternatives considered

| Alternative | Rejected because |
| --- | --- |
| A local-only mode, with the account claimed later | Real and defensible, and it costs little because adopting an account already preserves local data when the device held none. Deferred: the first run needs a connection for the region download anyway. |
| Verifying a cached credential offline, by hash | Protects against nothing the lock screen does not already cover, and adds a password prompt in the worst possible place. |
| SQLCipher for the local database | The key would ship with the application or sit in the Keystore beside the data. It raises the cost of an attack that the lock screen already stops. |

## Follow-up

Answers the first correction received on the Módulo 3 submission, which asked
how authentication, identification and permissions behave while the device is
disconnected.
